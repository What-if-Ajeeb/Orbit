use orbit_sandbox_core::{default_policy, dispatch_json, execute_program, validate_manifest};
use serde_json::json;

fn manifest(instructions: serde_json::Value) -> serde_json::Value {
    json!({
        "pluginId": "orbit.example.sandbox",
        "version": "1.0.0",
        "program": { "version": 1, "instructions": instructions }
    })
}

#[test]
fn describe_reports_fixed_policy_without_allowing_caller_overrides() {
    let response: serde_json::Value =
        serde_json::from_str(&dispatch_json(r#"{"id":"1","method":"describe","params":{}}"#))
            .expect("describe returns JSON");

    assert_eq!(response["id"], "1");
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["isolation"], "android-isolated-process");
    assert_eq!(
        response["result"]["executionFormat"],
        "deterministic-json-program"
    );
    assert!(response["result"]["allowedOperations"]
        .as_array()
        .is_some_and(|ops| ops.contains(&json!("push"))));
}

#[test]
fn valid_program_executes_without_side_effects() {
    let program = manifest(json!([
        { "op": "push", "value": "orb" },
        { "op": "push", "value": "it" },
        { "op": "concat" },
        { "op": "emit", "key": "greeting" },
        { "op": "load", "key": "input" },
        { "op": "emit", "key": "echo" },
        { "op": "return" }
    ]));
    let input = json!({ "text": "hello" });

    let result = execute_program(&program, &input, &default_policy());

    assert!(result.ok, "{:?}", result.errors);
    assert_eq!(result.outputs["greeting"], json!("orbit"));
    assert_eq!(result.outputs["echo"], input);
    assert_eq!(result.instructions_executed, 7);
}

#[test]
fn disallowed_operation_is_rejected_before_execution() {
    let program = manifest(json!([
        { "op": "fetch", "url": "https://example.com" }
    ]));

    let report = validate_manifest(&program, &default_policy());

    assert!(!report.ok);
    assert!(report
        .errors
        .iter()
        .any(|error| error.contains("disallowed op: fetch")));
}

#[test]
fn unknown_manifest_fields_are_rejected() {
    let program = json!({
        "pluginId": "orbit.example.sandbox",
        "version": "1.0.0",
        "nativeCode": "should never run",
        "program": { "version": 1, "instructions": [{ "op": "return" }] }
    });

    let report = validate_manifest(&program, &default_policy());

    assert!(!report.ok);
    assert!(report
        .errors
        .iter()
        .any(|error| error.contains("Unknown manifest field: nativeCode")));
}

#[test]
fn validate_rpc_unwraps_the_manifest_parameter() {
    let response: serde_json::Value = serde_json::from_str(&dispatch_json(
        r#"{"id":"4","method":"validateManifest","params":{"manifest":{"pluginId":"orbit.example.sandbox","version":"1.0.0","program":{"version":1,"instructions":[{"op":"return"}]}}}}"#,
    ))
    .expect("validate returns JSON");

    assert_eq!(response["id"], "4");
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["ok"], true);
}

#[test]
fn input_fields_are_loaded_from_the_host_supplied_input() {
    let program = manifest(json!([
        { "op": "load", "key": "input", "field": "count" },
        { "op": "push", "value": 2 },
        { "op": "mul" },
        { "op": "emit", "key": "doubled" }
    ]));

    let result = execute_program(&program, &json!({ "count": 21 }), &default_policy());

    assert!(result.ok, "{:?}", result.errors);
    assert_eq!(result.outputs["doubled"], json!(42));
}

#[test]
fn execution_rejects_unknown_method_and_envelope_size() {
    let unknown = serde_json::from_str::<serde_json::Value>(&dispatch_json(
        r#"{"id":"2","method":"exec","params":{}}"#,
    ))
    .expect("returns JSON");
    assert_eq!(unknown["ok"], false);
    assert_eq!(unknown["error"]["code"], "unsupported_method");

    let oversized = format!("{{\"id\":\"3\",\"method\":\"describe\",\"params\":{}}}", "x".repeat(70_000));
    let response: serde_json::Value =
        serde_json::from_str(&dispatch_json(&oversized)).expect("returns JSON");
    assert_eq!(response["error"]["code"], "envelope_too_large");
}

#[test]
fn arithmetic_overflow_is_a_controlled_error() {
    let program = manifest(json!([
        { "op": "push", "value": 9223372036854775807i64 },
        { "op": "push", "value": 1 },
        { "op": "add" }
    ]));

    let result = execute_program(&program, &json!({}), &default_policy());

    assert!(!result.ok);
    assert!(result
        .errors
        .iter()
        .any(|error| error.contains("overflowed")));
}
