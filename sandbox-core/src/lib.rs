//! Security-sensitive core for the ORBIT Android mobile sandbox.
//!
//! This crate is deliberately data-only. Android code sends JSON requests over
//! a Binder/Messenger boundary; this crate validates manifests, evaluates
//! policy, checks permissions and approvals, validates paths, URLs and request
//! envelopes, and returns a structured audit record for every decision.
//!
//! It never reads files, opens sockets, loads JavaScript or native code, or
//! executes guest instructions. The app-process Kotlin boundary performs any
//! bounded platform operation only after this core returns `allow`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const CORE_VERSION: &str = "0.2.0";
pub const POLICY_VERSION: u32 = 3;
pub const MAX_ENVELOPE_BYTES: usize = 64 * 1024;

const PLUGIN_ID_MAX_LEN: usize = 128;
const VERSION_MAX_LEN: usize = 32;
const MAX_SEGMENT_BYTES: usize = 255;
const APPROVAL_CLOCK_SKEW_MS: u64 = 60_000;

const SECURITY_CAPABILITIES: [&str; 7] = [
    "manifest-validation",
    "permission-enforcement",
    "approval-enforcement",
    "path-validation",
    "network-policy-validation",
    "request-validation",
    "audit-events",
];

const ALLOWED_OPERATIONS: [&str; 5] = [
    "file.read",
    "file.stat",
    "file.write",
    "file.delete",
    "network.request",
];

const SANDBOX_PERMISSIONS: [&str; 4] = [
    "files.read",
    "files.write",
    "network.access",
    "sandbox.inspect",
];

/// Every permission a plugin manifest may declare. `sandbox.execute` is
/// intentionally absent: execution is not a capability of this sandbox.
const KNOWN_PERMISSIONS: [&str; 21] = [
    "network.access",
    "storage.read",
    "storage.write",
    "files.read",
    "files.write",
    "notifications.send",
    "camera.access",
    "microphone.access",
    "location.access",
    "contacts.read",
    "calendar.read",
    "calendar.write",
    "clipboard.read",
    "clipboard.write",
    "ai.invoke",
    "ai.context.read",
    "mcp.connect",
    "credentials.request",
    "background.execute",
    "ui.contribute",
    "sandbox.inspect",
];

const ALLOWED_METHODS: [&str; 7] = [
    "describe",
    "validateManifest",
    "checkPermission",
    "validatePath",
    "validateNetwork",
    "validateRequest",
    "authorizeOperation",
];

const FORBIDDEN_FIELDS: [&str; 8] = [
    "program",
    "instructions",
    "execute",
    "handler",
    "code",
    "script",
    "eval",
    "sandbox.execute",
];

static AUDIT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn default_policy() -> Policy {
    Policy {
        version: POLICY_VERSION,
        allowed_operations: ALLOWED_OPERATIONS.iter().map(|op| (*op).to_owned()).collect(),
        allowed_network_schemes: vec!["https".to_owned()],
        allowed_network_hosts: vec!["*".to_owned()],
        max_envelope_bytes: MAX_ENVELOPE_BYTES,
        max_file_bytes: 256 * 1024,
        max_path_bytes: 1_024,
        max_network_url_bytes: 2_048,
        max_request_fields: 32,
        approval_ttl_seconds: 300,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub version: u32,
    pub allowed_operations: Vec<String>,
    pub allowed_network_schemes: Vec<String>,
    pub allowed_network_hosts: Vec<String>,
    pub max_envelope_bytes: usize,
    pub max_file_bytes: usize,
    pub max_path_bytes: usize,
    pub max_network_url_bytes: usize,
    pub max_request_fields: usize,
    pub approval_ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub id: String,
    pub at: u64,
    pub plugin_id: String,
    pub operation: String,
    pub decision: String,
    pub reason_code: String,
    pub permission: Option<String>,
    pub resource_hash: Option<String>,
    pub bytes: usize,
    pub duration_ms: u64,
    pub policy_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub ok: bool,
    pub errors: Vec<String>,
    pub policy_version: u32,
    pub audit: AuditRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorInfo {
    code: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<ErrorInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Call {
    id: String,
    method: String,
    params: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestParams {
    manifest: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalEvidence {
    permission: String,
    granted_at: u64,
    expires_at: u64,
    /// The exact resource this grant covers. Rust normalizes it with the same
    /// path/URL rules as the operation before comparing, so a grant cannot be
    /// replayed against another file or endpoint.
    #[serde(default)]
    resource: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermissionParams {
    manifest: Value,
    #[serde(default)]
    granted_permissions: Vec<String>,
    requested_permission: String,
    #[serde(default)]
    approval: Option<ApprovalEvidence>,
    #[serde(default)]
    now: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceRequest {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorizeParams {
    manifest: Value,
    operation: String,
    #[serde(default)]
    granted_permissions: Vec<String>,
    #[serde(default)]
    approval: Option<ApprovalEvidence>,
    #[serde(default)]
    resource: ResourceRequest,
    #[serde(default)]
    now: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkParams {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestParams {
    method: String,
    envelope_bytes: usize,
    #[serde(default)]
    fields: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathReport {
    ok: bool,
    normalized_path: Option<String>,
    errors: Vec<String>,
    policy_version: u32,
    audit: AuditRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkReport {
    ok: bool,
    normalized_url: Option<String>,
    errors: Vec<String>,
    policy_version: u32,
    audit: AuditRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestReport {
    ok: bool,
    errors: Vec<String>,
    policy_version: u32,
    audit: AuditRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionDecision {
    allowed: bool,
    permission: String,
    declared: bool,
    granted: bool,
    approval_required: bool,
    reason: String,
    reason_code: String,
    policy_version: u32,
    audit: AuditRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    max_envelope_bytes: usize,
    max_file_bytes: usize,
    max_path_bytes: usize,
    max_network_url_bytes: usize,
    max_request_fields: usize,
    approval_ttl_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationDecision {
    decision: String,
    operation: String,
    permission: Option<String>,
    normalized_resource: Option<String>,
    reason: String,
    reason_code: String,
    policy_version: u32,
    limits: Limits,
    audit: AuditRecord,
}

/// Exposed to Kotlin through JNI. Returns a JSON response for every request,
/// including malformed requests, so native errors never cross the FFI boundary.
pub fn dispatch_json(raw: &str) -> String {
    if raw.as_bytes().len() > MAX_ENVELOPE_BYTES {
        return error_response(
            "",
            "envelope_too_large",
            "Sandbox request exceeds the maximum envelope size.",
        );
    }

    let call: Call = match serde_json::from_str(raw) {
        Ok(call) => call,
        Err(error) => {
            return error_response("", "invalid_envelope", format!("Invalid sandbox call: {error}"));
        }
    };

    let policy = default_policy();
    let result = (|| -> Result<Value, (&'static str, String)> {
        match call.method.as_str() {
            "describe" => describe(&policy),
            "validateManifest" => {
                let params: ManifestParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                let report = validate_manifest(&params.manifest, &policy);
                serde_json::to_value(report)
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "checkPermission" => {
                let params: PermissionParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                serde_json::to_value(check_permission(&params, &policy))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "validatePath" => {
                let params: PathParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                serde_json::to_value(validate_path_report(&params, &policy))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "validateNetwork" => {
                let params: NetworkParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                serde_json::to_value(validate_network_report(&params, &policy))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "validateRequest" => {
                let params: RequestParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                serde_json::to_value(validate_request_report(&params, &policy))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "authorizeOperation" => {
                let params: AuthorizeParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_params", error.to_string()))?;
                serde_json::to_value(authorize_operation(&params, &policy))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            _ => Err((
                "unsupported_method",
                format!("Unsupported sandbox method: {}", call.method),
            )),
        }
    })();

    match result {
        Ok(value) => serde_json::to_string(&Response {
            id: call.id.clone(),
            ok: true,
            result: Some(value),
            error: None,
        })
        .unwrap_or_else(|_| {
            error_response(
                &call.id,
                "serialization_failed",
                "Unable to serialize sandbox response.",
            )
        }),
        Err((code, message)) => error_response(&call.id, code, message),
    }
}

fn describe(policy: &Policy) -> Result<Value, (&'static str, String)> {
    Ok(json!({
        "coreVersion": CORE_VERSION,
        "policyVersion": policy.version,
        "isolation": "android-isolated-process",
        "securityCapabilities": SECURITY_CAPABILITIES,
        "allowedOperations": policy.allowed_operations,
        "permissions": SANDBOX_PERMISSIONS,
        "execution": false,
        "limits": Limits {
            max_envelope_bytes: policy.max_envelope_bytes,
            max_file_bytes: policy.max_file_bytes,
            max_path_bytes: policy.max_path_bytes,
            max_network_url_bytes: policy.max_network_url_bytes,
            max_request_fields: policy.max_request_fields,
            approval_ttl_seconds: policy.approval_ttl_seconds,
        },
    }))
}

fn error_response(id: &str, code: &str, message: impl Into<String>) -> String {
    serde_json::to_string(&Response {
        id: id.to_owned(),
        ok: false,
        result: None,
        error: Some(ErrorInfo {
            code: code.to_owned(),
            message: message.into(),
        }),
    })
    .unwrap_or_else(|_| {
        r#"{"id":"","ok":false,"result":null,"error":{"code":"serialization_failed","message":"Unable to serialize sandbox error."}}"#
            .to_owned()
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn audit_record(
    plugin_id: &str,
    operation: &str,
    decision: &str,
    reason_code: &str,
    permission: Option<&str>,
    resource: Option<&str>,
    bytes: usize,
    started: Instant,
    policy: &Policy,
) -> AuditRecord {
    let sequence = AUDIT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let at = now_ms();
    AuditRecord {
        id: format!("audit-{at}-{sequence}"),
        at,
        plugin_id: plugin_id.to_owned(),
        operation: operation.to_owned(),
        decision: decision.to_owned(),
        reason_code: reason_code.to_owned(),
        permission: permission.map(str::to_owned),
        resource_hash: resource.map(fnv1a64),
        bytes,
        duration_ms: started.elapsed().as_millis() as u64,
        policy_version: policy.version,
    }
}

fn fnv1a64(value: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }

    format!("{hash:016x}")
}

fn required_string<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn is_valid_plugin_id(id: &str) -> bool {
    if id.is_empty() || id.len() > PLUGIN_ID_MAX_LEN {
        return false;
    }

    let mut previous_separator = true;
    for ch in id.chars() {
        if ch == '.' || ch == '-' {
            if previous_separator {
                return false;
            }
            previous_separator = true;
        } else if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            previous_separator = false;
        } else {
            return false;
        }
    }

    !previous_separator && id.chars().next().is_some_and(|ch| ch.is_ascii_lowercase())
}

fn is_valid_version(version: &str) -> bool {
    if version.is_empty() || version.len() > VERSION_MAX_LEN {
        return false;
    }

    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn is_known_permission(permission: &str) -> bool {
    KNOWN_PERMISSIONS.contains(&permission)
}

/// Validates the security-relevant subset of a plugin manifest. Unknown fields
/// are ignored because the full plugin manifest has presentation metadata; any
/// execution-shaped field or `sandbox.execute` permission is rejected.
pub fn validate_manifest(manifest: &Value, policy: &Policy) -> ValidationReport {
    let started = Instant::now();
    let mut errors = Vec::new();
    let mut plugin_id = String::new();

    let Some(object) = manifest.as_object() else {
        return validation_report(
            false,
            vec!["Manifest must be a JSON object.".to_owned()],
            "manifest.validate",
            "",
            "invalid_manifest",
            started,
            policy,
        );
    };

    for key in object.keys() {
        if FORBIDDEN_FIELDS.contains(&key.as_str()) {
            errors.push(format!("Manifest field \"{key}\" is not allowed."));
        }
    }

    match required_string(object, "pluginId") {
        Some(id) if is_valid_plugin_id(id) => plugin_id = id.to_owned(),
        Some(_) => errors.push("pluginId must be a lowercase dotted plugin identifier.".to_owned()),
        None => errors.push("Manifest is missing pluginId.".to_owned()),
    }

    match required_string(object, "version") {
        Some(version) if is_valid_version(version) => {}
        Some(_) => errors.push("version must look like 1.2.3.".to_owned()),
        None => errors.push("Manifest is missing version.".to_owned()),
    }

    if let Some(permissions) = object.get("permissions") {
        match permissions.as_array() {
            Some(entries) => {
                for (index, entry) in entries.iter().enumerate() {
                    match entry.as_str() {
                        Some("sandbox.execute") => errors.push(format!(
                            "permissions[{index}] requests sandbox.execute; execution is not supported."
                        )),
                        Some(permission) if is_known_permission(permission) => {}
                        Some(permission) => {
                            errors.push(format!("permissions[{index}] is unknown: {permission}"))
                        }
                        None => errors.push(format!("permissions[{index}] must be a string.")),
                    }
                }
            }
            None => errors.push("permissions must be an array.".to_owned()),
        }
    }

    if let Some(capabilities) = object.get("capabilities") {
        match capabilities.as_array() {
            Some(entries) => {
                for (index, entry) in entries.iter().enumerate() {
                    match entry.as_str() {
                        Some(capability)
                            if !capability.is_empty()
                                && capability.len() <= 128
                                && capability
                                    .chars()
                                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '-')) => {}
                        Some(_) => errors
                            .push(format!("capabilities[{index}] is not a valid capability.")),
                        None => errors.push(format!("capabilities[{index}] must be a string.")),
                    }
                }
            }
            None => errors.push("capabilities must be an array.".to_owned()),
        }
    }

    let ok = errors.is_empty();
    let reason_code = if ok { "valid" } else { "invalid_manifest" };
    validation_report(
        ok,
        errors,
        "manifest.validate",
        &plugin_id,
        reason_code,
        started,
        policy,
    )
}

fn validation_report(
    ok: bool,
    errors: Vec<String>,
    operation: &str,
    plugin_id: &str,
    reason_code: &str,
    started: Instant,
    policy: &Policy,
) -> ValidationReport {
    ValidationReport {
        ok,
        errors,
        policy_version: policy.version,
        audit: audit_record(
            plugin_id,
            operation,
            if ok { "allow" } else { "deny" },
            reason_code,
            None,
            None,
            0,
            started,
            policy,
        ),
    }
}

fn is_sensitive_permission(permission: &str) -> bool {
    matches!(permission, "files.read" | "files.write" | "network.access")
}

fn evaluate_approval(
    permission: &str,
    approval: Option<&ApprovalEvidence>,
    policy: &Policy,
    now: u64,
) -> Result<(), (&'static str, String)> {
    let Some(approval) = approval else {
        return Err((
            "approval_required",
            format!("A fresh user approval is required for {permission}."),
        ));
    };

    if approval.permission != permission {
        return Err((
            "approval_permission_mismatch",
            "Approval evidence does not cover the requested permission.".to_owned(),
        ));
    }

    if approval.granted_at > now.saturating_add(APPROVAL_CLOCK_SKEW_MS) {
        return Err((
            "approval_not_yet_valid",
            "Approval was granted in the future.".to_owned(),
        ));
    }

    if approval.expires_at <= now {
        return Err((
            "approval_expired",
            "Approval has expired; ask the user again.".to_owned(),
        ));
    }

    if approval.expires_at <= approval.granted_at {
        return Err((
            "approval_invalid",
            "Approval expiry must be after it was granted.".to_owned(),
        ));
    }

    let _ = approval.request_id.as_deref();

    let ttl_ms = policy.approval_ttl_seconds.saturating_mul(1_000);

    if approval.expires_at.saturating_sub(approval.granted_at) > ttl_ms {
        return Err((
            "approval_ttl_exceeded",
            format!(
                "Approval lifetime exceeds the {} second policy limit.",
                policy.approval_ttl_seconds
            ),
        ));
    }

    Ok(())
}

/// Checks that approval evidence is bound to the exact resource Rust authorized.
/// This runs after operation-specific normalization so `./a//b` cannot be used
/// to replay a grant for `a/b`, and a URL grant cannot be reused on another host.
fn evaluate_approval_resource(
    approval: Option<&ApprovalEvidence>,
    operation: &str,
    expected_resource: &str,
    policy: &Policy,
) -> Result<(), (&'static str, String)> {
    let Some(approval) = approval else {
        return Err((
            "approval_required",
            "A fresh user approval is required for this resource.".to_owned(),
        ));
    };

    let Some(bound_resource) = approval.resource.as_deref() else {
        return Err((
            "approval_resource_required",
            "Approval evidence must be bound to one resource.".to_owned(),
        ));
    };

    let normalized_bound = match operation {
        "file.read" | "file.stat" | "file.write" | "file.delete" => {
            validate_path_value(bound_resource, policy)
        }
        "network.request" => validate_network_value(bound_resource, policy),
        _ => {
            return Err((
                "unsupported_operation",
                format!("Unsupported sandbox operation: {operation}"),
            ))
        }
    }
    .map_err(|_| {
        (
            "approval_resource_invalid",
            "Approval evidence is bound to an invalid resource.".to_owned(),
        )
    })?;

    if normalized_bound != expected_resource {
        return Err((
            "approval_resource_mismatch",
            "Approval evidence is bound to a different resource.".to_owned(),
        ));
    }

    Ok(())
}

fn check_permission(params: &PermissionParams, policy: &Policy) -> PermissionDecision {
    let started = Instant::now();
    let now = params.now.unwrap_or_else(now_ms);
    let permission = params.requested_permission.as_str();
    let audit = |decision: &str,
                 reason_code: &str,
                 plugin_id: &str,
                 declared: bool,
                 granted: bool,
                 approval_required: bool| {
        let _ = declared;
        let _ = granted;
        let _ = approval_required;
        audit_record(
            plugin_id,
            "permission.check",
            decision,
            reason_code,
            Some(permission),
            None,
            0,
            started,
            policy,
        )
    };

    let validation = validate_manifest(&params.manifest, policy);
    let plugin_id = params
        .manifest
        .get("pluginId")
        .and_then(Value::as_str)
        .unwrap_or("");

    if !validation.ok {
        return PermissionDecision {
            allowed: false,
            permission: permission.to_owned(),
            declared: false,
            granted: false,
            approval_required: is_sensitive_permission(permission),
            reason: validation.errors.join(" "),
            reason_code: "invalid_manifest".to_owned(),
            policy_version: policy.version,
            audit: audit("deny", "invalid_manifest", plugin_id, false, false, false),
        };
    }

    if !SANDBOX_PERMISSIONS.contains(&permission) {
        return PermissionDecision {
            allowed: false,
            permission: permission.to_owned(),
            declared: false,
            granted: false,
            approval_required: false,
            reason: format!("Unknown sandbox permission: {permission}"),
            reason_code: "unknown_permission".to_owned(),
            policy_version: policy.version,
            audit: audit("deny", "unknown_permission", plugin_id, false, false, false),
        };
    }

    let declared = params
        .manifest
        .get("permissions")
        .and_then(Value::as_array)
        .is_some_and(|entries| entries.iter().any(|entry| entry.as_str() == Some(permission)));
    let granted = params
        .granted_permissions
        .iter()
        .any(|entry| entry == permission);
    let approval_required = is_sensitive_permission(permission);

    if !declared {
        return PermissionDecision {
            allowed: false,
            permission: permission.to_owned(),
            declared,
            granted,
            approval_required,
            reason: format!("The manifest does not declare {permission}."),
            reason_code: "permission_not_declared".to_owned(),
            policy_version: policy.version,
            audit: audit("deny", "permission_not_declared", plugin_id, declared, granted, approval_required),
        };
    }

    if !granted {
        return PermissionDecision {
            allowed: false,
            permission: permission.to_owned(),
            declared,
            granted,
            approval_required,
            reason: format!("The user has not granted {permission}."),
            reason_code: "permission_not_granted".to_owned(),
            policy_version: policy.version,
            audit: audit("deny", "permission_not_granted", plugin_id, declared, granted, approval_required),
        };
    }

    if approval_required {
        if let Err((code, message)) =
            evaluate_approval(permission, params.approval.as_ref(), policy, now)
        {
            return PermissionDecision {
                allowed: false,
                permission: permission.to_owned(),
                declared,
                granted,
                approval_required,
                reason: message,
                reason_code: code.to_owned(),
                policy_version: policy.version,
                audit: audit("deny", code, plugin_id, declared, granted, approval_required),
            };
        }
    }

    PermissionDecision {
        allowed: true,
        permission: permission.to_owned(),
        declared,
        granted,
        approval_required,
        reason: format!("{permission} is declared, granted and approved."),
        reason_code: "allowed".to_owned(),
        policy_version: policy.version,
        audit: audit("allow", "allowed", plugin_id, declared, granted, approval_required),
    }
}

fn permission_for_operation(operation: &str) -> Option<&'static str> {
    match operation {
        "file.read" | "file.stat" => Some("files.read"),
        "file.write" | "file.delete" => Some("files.write"),
        "network.request" => Some("network.access"),
        _ => None,
    }
}

fn authorize_operation(params: &AuthorizeParams, policy: &Policy) -> OperationDecision {
    let started = Instant::now();
    let now = params.now.unwrap_or_else(now_ms);
    let plugin_id = params
        .manifest
        .get("pluginId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let permission = permission_for_operation(&params.operation);
    let resource = params
        .resource
        .path
        .as_deref()
        .or(params.resource.url.as_deref());

    let deny = |reason_code: &str, reason: String| OperationDecision {
        decision: "deny".to_owned(),
        operation: params.operation.clone(),
        permission: permission.map(str::to_owned),
        normalized_resource: None,
        reason,
        reason_code: reason_code.to_owned(),
        policy_version: policy.version,
        limits: limits(policy),
        audit: audit_record(
            plugin_id,
            &params.operation,
            "deny",
            reason_code,
            permission,
            resource,
            0,
            started,
            policy,
        ),
    };

    let Some(permission) = permission else {
        return deny(
            "unsupported_operation",
            format!("Unsupported sandbox operation: {}", params.operation),
        );
    };

    if !policy
        .allowed_operations
        .iter()
        .any(|allowed| allowed == &params.operation)
    {
        return deny(
            "operation_not_allowed",
            format!("Operation is not enabled by policy: {}", params.operation),
        );
    }

    let validation = validate_manifest(&params.manifest, policy);

    if !validation.ok {
        return deny("invalid_manifest", validation.errors.join(" "));
    }

    let permission_params = PermissionParams {
        manifest: params.manifest.clone(),
        granted_permissions: params.granted_permissions.clone(),
        requested_permission: permission.to_owned(),
        approval: params.approval.clone(),
        now: Some(now),
    };
    let permission_decision = check_permission(&permission_params, policy);

    if !permission_decision.allowed {
        return deny(
            &permission_decision.reason_code,
            permission_decision.reason,
        );
    }

    let normalized_resource = match params.operation.as_str() {
        "file.read" | "file.stat" | "file.write" | "file.delete" => {
            let Some(path) = params.resource.path.as_deref() else {
                return deny(
                    "missing_resource",
                    "A file operation requires a path.".to_owned(),
                );
            };

            match validate_path_value(path, policy) {
                Ok(normalized) => normalized,
                Err((code, message)) => return deny(code, message),
            }
        }
        "network.request" => {
            let Some(url) = params.resource.url.as_deref() else {
                return deny(
                    "missing_resource",
                    "A network operation requires a URL.".to_owned(),
                );
            };

            match validate_network_value(url, policy) {
                Ok(normalized) => normalized,
                Err((code, message)) => return deny(code, message),
            }
        }
        _ => {
            return deny(
                "unsupported_operation",
                format!("Unsupported sandbox operation: {}", params.operation),
            )
        }
    };

    if let Err((code, message)) = evaluate_approval_resource(
        params.approval.as_ref(),
        &params.operation,
        &normalized_resource,
        policy,
    ) {
        return deny(code, message);
    }

    OperationDecision {
        decision: "allow".to_owned(),
        operation: params.operation.clone(),
        permission: Some(permission.to_owned()),
        normalized_resource: Some(normalized_resource.clone()),
        reason: format!("{permission} is declared, granted and approved."),
        reason_code: "allowed".to_owned(),
        policy_version: policy.version,
        limits: limits(policy),
        audit: audit_record(
            plugin_id,
            &params.operation,
            "allow",
            "allowed",
            Some(permission),
            Some(&normalized_resource),
            0,
            started,
            policy,
        ),
    }
}

fn limits(policy: &Policy) -> Limits {
    Limits {
        max_envelope_bytes: policy.max_envelope_bytes,
        max_file_bytes: policy.max_file_bytes,
        max_path_bytes: policy.max_path_bytes,
        max_network_url_bytes: policy.max_network_url_bytes,
        max_request_fields: policy.max_request_fields,
        approval_ttl_seconds: policy.approval_ttl_seconds,
    }
}

fn validate_path_report(params: &PathParams, policy: &Policy) -> PathReport {
    let started = Instant::now();
    let result = validate_path_value(&params.path, policy);
    let (ok, normalized_path, errors) = match result {
        Ok(path) => (true, Some(path), Vec::new()),
        Err((code, message)) => (false, None, vec![format!("{code}: {message}")]),
    };
    let reason_code = if ok { "valid_path" } else { "invalid_path" };

    PathReport {
        ok,
        normalized_path,
        errors,
        policy_version: policy.version,
        audit: audit_record(
            "",
            "path.validate",
            if ok { "allow" } else { "deny" },
            reason_code,
            Some("files.read"),
            Some(&params.path),
            0,
            started,
            policy,
        ),
    }
}

fn validate_network_report(params: &NetworkParams, policy: &Policy) -> NetworkReport {
    let started = Instant::now();
    let result = validate_network_value(&params.url, policy);
    let (ok, normalized_url, errors) = match result {
        Ok(url) => (true, Some(url), Vec::new()),
        Err((code, message)) => (false, None, vec![format!("{code}: {message}")]),
    };
    let reason_code = if ok { "valid_url" } else { "invalid_url" };

    NetworkReport {
        ok,
        normalized_url,
        errors,
        policy_version: policy.version,
        audit: audit_record(
            "",
            "network.validate",
            if ok { "allow" } else { "deny" },
            reason_code,
            Some("network.access"),
            Some(&params.url),
            0,
            started,
            policy,
        ),
    }
}

fn validate_request_report(params: &RequestParams, policy: &Policy) -> RequestReport {
    let started = Instant::now();
    let mut errors = Vec::new();

    if !ALLOWED_METHODS.contains(&params.method.as_str()) {
        errors.push(format!("Unsupported sandbox method: {}", params.method));
    }

    if params.envelope_bytes > policy.max_envelope_bytes {
        errors.push(format!(
            "Envelope is {} bytes; limit is {}.",
            params.envelope_bytes, policy.max_envelope_bytes
        ));
    }

    if let Some(fields) = &params.fields {
        match fields.as_object() {
            Some(object) => {
                if object.len() > policy.max_request_fields {
                    errors.push(format!(
                        "Request has {} fields; limit is {}.",
                        object.len(),
                        policy.max_request_fields
                    ));
                }

                for key in object.keys() {
                    if FORBIDDEN_FIELDS.contains(&key.as_str()) {
                        errors.push(format!("Request field \"{key}\" is not allowed."));
                    }
                }

                scan_forbidden_values(fields, 0, &mut errors);
            }
            None => errors.push("fields must be a JSON object.".to_owned()),
        }
    }

    let ok = errors.is_empty();

    RequestReport {
        ok,
        errors,
        policy_version: policy.version,
        audit: audit_record(
            "",
            "request.validate",
            if ok { "allow" } else { "deny" },
            if ok { "valid_request" } else { "invalid_request" },
            None,
            Some(&params.method),
            0,
            started,
            policy,
        ),
    }
}

fn scan_forbidden_values(value: &Value, depth: usize, errors: &mut Vec<String>) {
    if depth > 8 {
        errors.push("Request fields are nested too deeply.".to_owned());
        return;
    }

    match value {
        Value::Object(object) => {
            for (key, entry) in object {
                if FORBIDDEN_FIELDS.contains(&key.as_str()) {
                    errors.push(format!("Request field \"{key}\" is not allowed."));
                }
                scan_forbidden_values(entry, depth + 1, errors);
            }
        }
        Value::Array(entries) => {
            for entry in entries {
                scan_forbidden_values(entry, depth + 1, errors);
            }
        }
        Value::String(text) if text == "sandbox.execute" => {
            errors.push("sandbox.execute is not a supported permission.".to_owned());
        }
        _ => {}
    }
}

fn decode_percent(value: &str) -> Result<String, (&'static str, String)> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err((
                    "invalid_encoding",
                    "Path contains an incomplete percent escape.".to_owned(),
                ));
            }

            let hex = &value[index + 1..index + 3];

            if !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err((
                    "invalid_encoding",
                    "Path contains an invalid percent escape.".to_owned(),
                ));
            }

            let decoded = u8::from_str_radix(hex, 16).map_err(|_| {
                (
                    "invalid_encoding",
                    "Path contains an invalid percent escape.".to_owned(),
                )
            })?;

            if decoded == b'/' || decoded == b'\\' {
                return Err((
                    "encoded_traversal",
                    "Percent-encoded path separators are not allowed.".to_owned(),
                ));
            }

            output.push(decoded);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(output).map_err(|_| {
        (
            "invalid_encoding",
            "Path must be valid UTF-8 after percent decoding.".to_owned(),
        )
    })
}

fn validate_path_value(path: &str, policy: &Policy) -> Result<String, (&'static str, String)> {
    if path.is_empty() {
        return Err(("invalid_path", "Path must not be empty.".to_owned()));
    }

    if path.len() > policy.max_path_bytes {
        return Err((
            "path_too_long",
            format!(
                "Path is {} bytes; limit is {}.",
                path.len(),
                policy.max_path_bytes
            ),
        ));
    }

    if path.contains('\0') {
        return Err(("invalid_path", "Path must not contain NUL bytes.".to_owned()));
    }

    if path.contains('\\') {
        return Err((
            "invalid_path",
            "Path must use forward slashes only.".to_owned(),
        ));
    }

    if path.starts_with('/') || path.starts_with('~') {
        return Err((
            "absolute_path",
            "Path must be relative to the sandbox root.".to_owned(),
        ));
    }

    if path
        .as_bytes()
        .get(1)
        .is_some_and(|byte| *byte == b':')
        && path
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_alphabetic())
    {
        return Err((
            "absolute_path",
            "Drive-letter paths are not allowed.".to_owned(),
        ));
    }

    let decoded = decode_percent(path)?;

    if decoded.contains('\0') {
        return Err(("invalid_path", "Path must not contain NUL bytes.".to_owned()));
    }

    let mut segments: Vec<&str> = Vec::new();

    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }

        if segment == ".." {
            return Err((
                "path_traversal",
                "Path traversal segments are not allowed.".to_owned(),
            ));
        }

        if segment.len() > MAX_SEGMENT_BYTES {
            return Err((
                "path_too_long",
                format!("Path segment exceeds {MAX_SEGMENT_BYTES} bytes."),
            ));
        }

        if segment.contains(':') {
            return Err((
                "invalid_path",
                "Path segments must not contain a colon.".to_owned(),
            ));
        }

        if segment.chars().any(char::is_control) {
            return Err((
                "invalid_path",
                "Path segments must not contain control characters.".to_owned(),
            ));
        }

        segments.push(segment);
    }

    if segments.is_empty() {
        return Err(("invalid_path", "Path must name a resource.".to_owned()));
    }

    Ok(segments.join("/"))
}

fn parse_host_port(authority: &str) -> Result<(String, String), (&'static str, String)> {
    if authority.is_empty() {
        return Err(("invalid_url", "URL authority is empty.".to_owned()));
    }

    if authority.contains('@') {
        return Err((
            "userinfo_not_allowed",
            "URLs must not contain credentials or userinfo.".to_owned(),
        ));
    }

    if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return Err(("invalid_url", "IPv6 host is missing its closing bracket.".to_owned()));
        };

        let host = &authority[1..end];
        let rest = &authority[end + 1..];

        if host.is_empty()
            || !host
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, ':' | '.'))
        {
            return Err(("invalid_url", "IPv6 host is invalid.".to_owned()));
        }

        let port = if rest.is_empty() {
            String::new()
        } else if let Some(port) = rest.strip_prefix(':') {
            validate_port(port)?;
            format!(":{port}")
        } else {
            return Err(("invalid_url", "Unexpected characters after IPv6 host.".to_owned()));
        };

        return Ok((host.to_ascii_lowercase(), port));
    }

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => {
            validate_port(port)?;
            (host, format!(":{port}"))
        }
        _ => (authority, String::new()),
    };

    if host.is_empty() {
        return Err(("invalid_url", "URL host is empty.".to_owned()));
    }

    Ok((host.to_ascii_lowercase(), port))
}

fn validate_port(port: &str) -> Result<(), (&'static str, String)> {
    if port.is_empty() || !port.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(("invalid_url", "URL port must be numeric.".to_owned()));
    }

    match port.parse::<u16>() {
        Ok(0) | Err(_) => Err(("invalid_url", "URL port must be between 1 and 65535.".to_owned())),
        Ok(_) => Ok(()),
    }
}

fn is_valid_hostname(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }

    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn is_private_host(host: &str) -> bool {
    let host = host.trim_end_matches('.');

    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return true;
    }

    if host == "::1" || host == "0.0.0.0" {
        return true;
    }

    if let Some(rest) = host.strip_prefix("127.") {
        return rest
            .split('.')
            .all(|part| part.parse::<u8>().is_ok());
    }

    if let Some(rest) = host.strip_prefix("10.") {
        return rest.split('.').all(|part| part.parse::<u8>().is_ok());
    }

    if let Some(rest) = host.strip_prefix("192.168.") {
        return rest.split('.').all(|part| part.parse::<u8>().is_ok());
    }

    if let Some(rest) = host.strip_prefix("169.254.") {
        return rest.split('.').all(|part| part.parse::<u8>().is_ok());
    }

    if let Some(rest) = host.strip_prefix("172.") {
        if let Some((second, tail)) = rest.split_once('.') {
            if let Ok(second) = second.parse::<u8>() {
                if (16..=31).contains(&second)
                    && tail.split('.').all(|part| part.parse::<u8>().is_ok())
                {
                    return true;
                }
            }
        }
    }

    host.starts_with("fe80:")
        || host.starts_with("fc")
        || host.starts_with("fd")
}

fn host_is_allowed(host: &str, policy: &Policy) -> bool {
    if policy
        .allowed_network_hosts
        .iter()
        .any(|allowed| allowed == "*")
    {
        return true;
    }

    policy.allowed_network_hosts.iter().any(|allowed| {
        let allowed = allowed.to_ascii_lowercase();
        host == allowed || host.ends_with(&format!(".{allowed}"))
    })
}

fn validate_network_value(url: &str, policy: &Policy) -> Result<String, (&'static str, String)> {
    if url.is_empty() {
        return Err(("invalid_url", "URL must not be empty.".to_owned()));
    }

    if url.len() > policy.max_network_url_bytes {
        return Err((
            "url_too_long",
            format!(
                "URL is {} bytes; limit is {}.",
                url.len(),
                policy.max_network_url_bytes
            ),
        ));
    }

    if url.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err((
            "invalid_url",
            "URL must not contain whitespace or control characters.".to_owned(),
        ));
    }

    let Some((scheme, rest)) = url.split_once("://") else {
        return Err((
            "invalid_url",
            "URL must include an explicit scheme and host.".to_owned(),
        ));
    };

    let scheme = scheme.to_ascii_lowercase();

    if !policy
        .allowed_network_schemes
        .iter()
        .any(|allowed| allowed == &scheme)
    {
        return Err((
            "scheme_not_allowed",
            format!("URL scheme is not allowed: {scheme}"),
        ));
    }

    if rest.is_empty() {
        return Err(("invalid_url", "URL host is empty.".to_owned()));
    }

    let authority_end = rest
        .find(|ch| matches!(ch, '/' | '?' | '#'))
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let (host, port) = parse_host_port(authority)?;

    if host.is_empty() {
        return Err(("invalid_url", "URL host is empty.".to_owned()));
    }

    let bracketed = authority.starts_with('[');
    let host_ok = if bracketed {
        host.chars()
            .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, ':' | '.'))
    } else {
        is_valid_hostname(&host)
    };

    if !host_ok {
        return Err(("invalid_url", "URL host is invalid.".to_owned()));
    }

    if is_private_host(&host) {
        return Err((
            "private_host_not_allowed",
            "Private, loopback and link-local hosts are not allowed.".to_owned(),
        ));
    }

    if !host_is_allowed(&host, policy) {
        return Err((
            "host_not_allowed",
            format!("URL host is not on the policy allowlist: {host}"),
        ));
    }

    let path_and_query = &rest[authority_end..];
    let path_and_query = path_and_query.split('#').next().unwrap_or("");

    Ok(format!("{scheme}://{host}{port}{path_and_query}"))
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_orbit_sandbox_SandboxNative_nativeDispatch<'caller>(
    mut unowned_env: jni::EnvUnowned<'caller>,
    _class: jni::objects::JClass<'caller>,
    input: jni::objects::JString<'caller>,
) -> jni::objects::JString<'caller> {
    let outcome = unowned_env.with_env(|env| -> Result<jni::objects::JString<'_>, jni::errors::Error> {
        let request: String = input.to_string();
        let response = std::panic::catch_unwind(|| dispatch_json(&request)).unwrap_or_else(|_| {
            error_response("", "native_panic", "Sandbox core recovered from a panic.")
        });
        jni::objects::JString::from_str(env, response)
    });
    outcome.resolve::<jni::errors::ThrowRuntimeExAndDefault>()
}
