use orbit_sandbox_core::{default_policy, dispatch_json, validate_manifest};
use serde_json::{json, Value};

fn call(method: &str, params: Value) -> Value {
    let response = dispatch_json(
        &json!({ "id": "test", "method": method, "params": params }).to_string(),
    );
    serde_json::from_str(&response).expect("dispatch returns JSON")
}

fn manifest() -> Value {
    json!({
        "pluginId": "orbit.example.reader",
        "version": "1.0.0",
        "permissions": ["ai.invoke", "files.read", "network.access", "sandbox.inspect"],
        "capabilities": ["tools.ai"]
    })
}

fn approval(permission: &str, resource: &str, now: u64) -> Value {
    json!({
        "permission": permission,
        "resource": resource,
        "grantedAt": now,
        "expiresAt": now + 60_000,
        "requestId": "approval-1"
    })
}

#[test]
fn describe_reports_security_only_capabilities() {
    let response = call("describe", json!({}));

    assert_eq!(response["id"], "test");
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["isolation"], "android-isolated-process");
    assert_eq!(response["result"]["execution"], false);
    assert!(response["result"]["securityCapabilities"]
        .as_array()
        .is_some_and(|entries| entries.contains(&json!("manifest-validation"))));
    assert!(response["result"]["allowedOperations"]
        .as_array()
        .is_some_and(|entries| entries.contains(&json!("file.read"))));
    assert!(!response["result"]["allowedOperations"]
        .as_array()
        .is_some_and(|entries| entries.contains(&json!("push"))));
}

#[test]
fn execution_methods_are_unsupported() {
    for method in ["executeProgram", "execute", "run", "eval"] {
        let response = call(method, json!({}));
        assert_eq!(response["ok"], false, "{method}");
        assert_eq!(response["error"]["code"], "unsupported_method", "{method}");
    }
}

#[test]
fn manifest_validation_rejects_execution_shaped_fields() {
    let report = validate_manifest(
        &json!({
            "pluginId": "orbit.example.bad",
            "version": "1.0.0",
            "program": { "version": 1, "instructions": [] }
        }),
        &default_policy(),
    );

    assert!(!report.ok);
    assert!(report
        .errors
        .iter()
        .any(|error| error.contains("program")));
}

#[test]
fn manifest_validation_rejects_sandbox_execute_permission() {
    let response = call(
        "validateManifest",
        json!({
            "manifest": {
                "pluginId": "orbit.example.bad",
                "version": "1.0.0",
                "permissions": ["sandbox.execute"]
            }
        }),
    );

    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["ok"], false);
    assert!(response["result"]["errors"]
        .as_array()
        .is_some_and(|errors| errors.iter().any(|error| error
            .as_str()
            .is_some_and(|text| text.contains("sandbox.execute")))));
    assert_eq!(response["result"]["audit"]["decision"], "deny");
}

#[test]
fn manifest_validation_accepts_security_metadata() {
    let report = validate_manifest(&manifest(), &default_policy());
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(report.audit.operation, "manifest.validate");
    assert_eq!(report.audit.decision, "allow");
}

#[test]
fn version_must_have_exactly_three_numeric_parts() {
    for bad in ["", "1", "1.2", "1.2.3.4", "1..3", "a.b.c", "1.2.x"] {
        let report = validate_manifest(
            &json!({
                "pluginId": "orbit.example.reader",
                "version": bad,
                "permissions": ["files.read"]
            }),
            &default_policy(),
        );
        assert!(!report.ok, "version {bad:?} should be rejected");
    }
}

#[test]
fn permission_check_requires_declaration_grant_and_fresh_approval() {
    let now = 1_000_000u64;

    let missing_grant = call(
        "checkPermission",
        json!({
            "manifest": manifest(),
            "grantedPermissions": [],
            "requestedPermission": "files.read",
            "approval": approval("files.read", "orbit/notes/today.txt", now),
            "now": now
        }),
    );
    assert_eq!(missing_grant["result"]["allowed"], false);
    assert_eq!(
        missing_grant["result"]["reasonCode"],
        "permission_not_granted"
    );

    let missing_approval = call(
        "checkPermission",
        json!({
            "manifest": manifest(),
            "grantedPermissions": ["files.read"],
            "requestedPermission": "files.read",
            "now": now
        }),
    );
    assert_eq!(missing_approval["result"]["allowed"], false);
    assert_eq!(
        missing_approval["result"]["reasonCode"],
        "approval_required"
    );

    let expired = call(
        "checkPermission",
        json!({
            "manifest": manifest(),
            "grantedPermissions": ["files.read"],
            "requestedPermission": "files.read",
            "approval": {
                "permission": "files.read",
                "grantedAt": now - 120_000,
                "expiresAt": now - 1_000
            },
            "now": now
        }),
    );
    assert_eq!(expired["result"]["allowed"], false);
    assert_eq!(expired["result"]["reasonCode"], "approval_expired");

    let allowed = call(
        "checkPermission",
        json!({
            "manifest": manifest(),
            "grantedPermissions": ["files.read"],
            "requestedPermission": "files.read",
            "approval": approval("files.read", "orbit/notes/today.txt", now),
            "now": now
        }),
    );
    assert_eq!(allowed["result"]["allowed"], true);
    assert_eq!(allowed["result"]["reasonCode"], "allowed");
    assert_eq!(allowed["result"]["audit"]["decision"], "allow");
}

#[test]
fn inspect_permission_is_read_only_and_needs_no_approval() {
    let response = call(
        "checkPermission",
        json!({
            "manifest": manifest(),
            "grantedPermissions": ["sandbox.inspect"],
            "requestedPermission": "sandbox.inspect"
        }),
    );

    assert_eq!(response["result"]["allowed"], true);
    assert_eq!(response["result"]["approvalRequired"], false);
}

#[test]
fn path_validation_rejects_traversal_and_encoded_separators() {
    for path in [
        "../secret",
        "orbit/../../secret",
        "/etc/passwd",
        "C:/secret",
        "orbit\\secret",
        "orbit/%2e%2e/secret",
        "orbit%2fsecret",
        "orbit\0secret",
    ] {
        let response = call("validatePath", json!({ "path": path }));
        assert_eq!(response["result"]["ok"], false, "path {path:?}");
        assert_eq!(response["result"]["audit"]["decision"], "deny");
    }
}

#[test]
fn path_validation_normalizes_safe_relative_paths() {
    let response = call("validatePath", json!({ "path": "./orbit//notes/./today.txt" }));
    assert_eq!(response["result"]["ok"], true);
    assert_eq!(
        response["result"]["normalizedPath"],
        "orbit/notes/today.txt"
    );
}

#[test]
fn network_validation_rejects_unsafe_schemes_and_private_hosts() {
    for url in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hello",
        "http://example.com",
        "https://localhost/secret",
        "https://127.0.0.1/secret",
        "https://10.0.0.5/secret",
        "https://user:pass@example.com/secret",
    ] {
        let response = call("validateNetwork", json!({ "url": url }));
        assert_eq!(response["result"]["ok"], false, "url {url:?}");
    }
}

#[test]
fn network_validation_normalizes_https_urls() {
    let response = call(
        "validateNetwork",
        json!({ "url": "HTTPS://Example.COM:443/path?q=1#fragment" }),
    );

    assert_eq!(response["result"]["ok"], true);
    assert_eq!(
        response["result"]["normalizedUrl"],
        "https://example.com:443/path?q=1"
    );
}

#[test]
fn request_validation_rejects_execution_fields_and_oversized_envelopes() {
    let response = call(
        "validateRequest",
        json!({
            "method": "authorizeOperation",
            "envelopeBytes": 200,
            "fields": { "program": { "instructions": [] } }
        }),
    );
    assert_eq!(response["result"]["ok"], false);

    let oversized = call(
        "validateRequest",
        json!({ "method": "describe", "envelopeBytes": 70_000 }),
    );
    assert_eq!(oversized["result"]["ok"], false);
}

#[test]
fn authorize_operation_allows_an_approved_file_read() {
    let now = 1_000_000u64;
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "approval": approval("files.read", "./orbit//notes/./today.txt", now),
            "resource": { "path": "./orbit/notes/today.txt" },
            "now": now
        }),
    );

    assert_eq!(response["result"]["decision"], "allow");
    assert_eq!(response["result"]["permission"], "files.read");
    assert_eq!(
        response["result"]["normalizedResource"],
        "orbit/notes/today.txt"
    );
    assert_eq!(response["result"]["audit"]["decision"], "allow");
    assert_eq!(response["result"]["audit"]["policyVersion"], 3);
}

#[test]
fn authorize_operation_denies_replayed_approval_with_different_request_id() {
    let now = 1_000_000u64;
    let request = |request_id: &str| {
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "approval": {
                "permission": "files.read",
                "resource": "orbit/replay/nonce.txt",
                "grantedAt": now,
                "expiresAt": now + 60_000,
                "requestId": request_id
            },
            "resource": { "path": "orbit/replay/nonce.txt" },
            "now": now
        })
    };

    let first = call("authorizeOperation", request("approval-original"));
    assert_eq!(first["result"]["decision"], "allow");
    assert_eq!(first["result"]["approvalRequestId"], "approval-original");
    assert_eq!(first["result"]["audit"]["requestId"], "approval-original");

    let replayed = call("authorizeOperation", request("approval-replayed"));
    assert_eq!(replayed["result"]["decision"], "deny");
    assert_eq!(replayed["result"]["reasonCode"], "approval_request_replay");
    assert_eq!(replayed["result"]["audit"]["decision"], "deny");
}

#[test]
fn authorize_operation_denies_when_approval_is_bound_to_another_path() {
    let now = 1_000_000u64;
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "approval": approval("files.read", "orbit/secret.txt", now),
            "resource": { "path": "orbit/notes/today.txt" },
            "now": now
        }),
    );

    assert_eq!(response["result"]["decision"], "deny");
    assert_eq!(response["result"]["reasonCode"], "approval_resource_mismatch");
    assert_eq!(response["result"]["audit"]["decision"], "deny");
}

#[test]
fn authorize_operation_denies_when_approval_has_no_resource() {
    let now = 1_000_000u64;
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "approval": {
                "permission": "files.read",
                "grantedAt": now,
                "expiresAt": now + 60_000
            },
            "resource": { "path": "orbit/notes/today.txt" },
            "now": now
        }),
    );

    assert_eq!(response["result"]["decision"], "deny");
    assert_eq!(response["result"]["reasonCode"], "approval_resource_required");
}

#[test]
fn authorize_operation_denies_when_approval_resource_is_unsafe() {
    let now = 1_000_000u64;
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "approval": approval("files.read", "../secret", now),
            "resource": { "path": "orbit/notes/today.txt" },
            "now": now
        }),
    );

    assert_eq!(response["result"]["decision"], "deny");
    assert_eq!(response["result"]["reasonCode"], "approval_resource_invalid");
}

#[test]
fn authorize_operation_binds_network_approval_to_normalized_url() {
    let now = 1_000_000u64;
    let approved = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "network.request",
            "grantedPermissions": ["network.access"],
            "approval": approval("network.access", "HTTPS://Example.COM/path", now),
            "resource": { "url": "https://example.com/path" },
            "now": now
        }),
    );
    assert_eq!(approved["result"]["decision"], "allow");
    assert_eq!(
        approved["result"]["normalizedResource"],
        "https://example.com/path"
    );

    let replayed = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "network.request",
            "grantedPermissions": ["network.access"],
            "approval": approval("network.access", "https://example.com/path", now),
            "resource": { "url": "https://example.com/other" },
            "now": now
        }),
    );
    assert_eq!(replayed["result"]["decision"], "deny");
    assert_eq!(replayed["result"]["reasonCode"], "approval_resource_mismatch");
}

#[test]
fn authorize_operation_denies_without_approval() {
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "file.read",
            "grantedPermissions": ["files.read"],
            "resource": { "path": "orbit/notes/today.txt" }
        }),
    );

    assert_eq!(response["result"]["decision"], "deny");
    assert_eq!(response["result"]["reasonCode"], "approval_required");
    assert_eq!(response["result"]["audit"]["decision"], "deny");
}

#[test]
fn authorize_operation_denies_execution_operations() {
    let response = call(
        "authorizeOperation",
        json!({
            "manifest": manifest(),
            "operation": "execute",
            "grantedPermissions": ["files.read"],
            "resource": { "path": "orbit/notes/today.txt" }
        }),
    );

    assert_eq!(response["result"]["decision"], "deny");
    assert_eq!(response["result"]["reasonCode"], "unsupported_operation");
}

#[test]
fn oversized_envelope_is_rejected_before_parsing() {
    let oversized = format!(
        "{{\"id\":\"3\",\"method\":\"describe\",\"params\":{{\"x\":\"{}\"}}}}",
        "x".repeat(70_000)
    );
    let response: Value = serde_json::from_str(&dispatch_json(&oversized)).expect("returns JSON");
    assert_eq!(response["error"]["code"], "envelope_too_large");
}

#[test]
fn unknown_params_are_rejected() {
    let response = call("validatePath", json!({ "path": "orbit/a.txt", "policy": {} }));
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "invalid_params");
}
