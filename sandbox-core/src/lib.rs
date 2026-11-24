//! Security-sensitive core for the ORBIT Android mobile sandbox.
//!
//! This crate is deliberately data-only. Android code sends JSON requests over
//! a Binder/Messenger boundary; this crate validates manifests, enforces a
//! fixed policy, and interprets a small deterministic instruction set. It never
//! loads JavaScript, native code, files, network resources, or device
//! permissions.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

pub const CORE_VERSION: &str = "0.1.0";
pub const POLICY_VERSION: u32 = 1;
pub const MAX_ENVELOPE_BYTES: usize = 64 * 1024;

const PLUGIN_ID_MAX_LEN: usize = 128;
const VERSION_MAX_LEN: usize = 32;
const EMIT_KEY_MAX_LEN: usize = 64;
const ALLOWED_INPUT_KEYS: [&str; 1] = ["input"];

pub fn default_policy() -> Policy {
    Policy {
        version: POLICY_VERSION,
        max_instructions: 256,
        max_stack_items: 64,
        max_output_bytes: 16 * 1024,
        max_value_bytes: 8 * 1024,
        allowed_operations: vec![
            "add".to_owned(),
            "concat".to_owned(),
            "emit".to_owned(),
            "load".to_owned(),
            "mul".to_owned(),
            "push".to_owned(),
            "return".to_owned(),
            "sub".to_owned(),
        ],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub version: u32,
    pub max_instructions: usize,
    pub max_stack_items: usize,
    pub max_output_bytes: usize,
    pub max_value_bytes: usize,
    pub allowed_operations: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub ok: bool,
    pub errors: Vec<String>,
    pub policy_version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub ok: bool,
    pub outputs: Value,
    pub instructions_executed: usize,
    pub errors: Vec<String>,
    pub policy_version: u32,
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
struct ValidateParams {
    manifest: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecuteParams {
    manifest: Value,
    input: Value,
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

    let result = (|| -> Result<Value, (&'static str, String)> {
        match call.method.as_str() {
            "describe" => describe(),
            "validateManifest" => {
                let params: ValidateParams = serde_json::from_value(call.params.clone())
                    .map_err(|error| ("invalid_validate_params", error.to_string()))?;
                serde_json::to_value(validate_manifest(&params.manifest, &default_policy()))
                    .map_err(|error| ("serialization_failed", error.to_string()))
            }
            "executeProgram" => execute_from_params(&call.params, &default_policy()),
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

fn describe() -> Result<Value, (&'static str, String)> {
    let policy = default_policy();
    Ok(json!({
        "coreVersion": CORE_VERSION,
        "policyVersion": policy.version,
        "isolation": "android-isolated-process",
        "executionFormat": "deterministic-json-program",
        "allowedOperations": policy.allowed_operations,
        "limits": {
            "maxInstructions": policy.max_instructions,
            "maxStackItems": policy.max_stack_items,
            "maxOutputBytes": policy.max_output_bytes,
            "maxValueBytes": policy.max_value_bytes,
            "maxEnvelopeBytes": MAX_ENVELOPE_BYTES,
        },
    }))
}

fn execute_from_params(
    params: &Value,
    policy: &Policy,
) -> Result<Value, (&'static str, String)> {
    let params: ExecuteParams = serde_json::from_value(params.clone())
        .map_err(|error| ("invalid_execute_params", error.to_string()))?;
    let result = execute_program(&params.manifest, &params.input, policy);
    serde_json::to_value(result).map_err(|error| ("serialization_failed", error.to_string()))
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

/// Validates a manifest against the fixed policy. This is also called before
/// every execution; callers cannot pass their own policy.
pub fn validate_manifest(manifest: &Value, policy: &Policy) -> ValidationReport {
    let mut errors = Vec::new();
    let Some(object) = manifest.as_object() else {
        return ValidationReport {
            ok: false,
            errors: vec!["Manifest must be a JSON object.".to_owned()],
            policy_version: policy.version,
        };
    };

    for key in object.keys() {
        if !matches!(key.as_str(), "pluginId" | "version" | "program") {
            errors.push(format!("Unknown manifest field: {key}"));
        }
    }

    match required_string(object, "pluginId") {
        Some(id) if is_valid_plugin_id(id) => {}
        Some(_) => errors.push("pluginId must be a lowercase dotted plugin identifier.".to_owned()),
        None => errors.push("Manifest is missing pluginId.".to_owned()),
    }

    match required_string(object, "version") {
        Some(version) if is_valid_version(version) => {}
        Some(_) => errors.push("version must look like 1.2.3.".to_owned()),
        None => errors.push("Manifest is missing version.".to_owned()),
    }

    let Some(program) = object.get("program").and_then(Value::as_object) else {
        errors.push("Manifest is missing a program object.".to_owned());
        return finish_validation(errors, policy);
    };

    for key in program.keys() {
        if !matches!(key.as_str(), "version" | "instructions") {
            errors.push(format!("Unknown program field: {key}"));
        }
    }

    match program.get("version").and_then(Value::as_u64) {
        Some(1) => {}
        Some(_) => errors.push("Program version must be 1.".to_owned()),
        None => errors.push("Program is missing version.".to_owned()),
    }

    let empty_instructions: &[Value] = &[];
    let instructions = match program.get("instructions").and_then(Value::as_array) {
        Some(instructions) if instructions.is_empty() => {
            errors.push("Program must contain at least one instruction.".to_owned());
            empty_instructions
        }
        Some(instructions) if instructions.len() > policy.max_instructions => {
            errors.push(format!(
                "Program has {} instructions; limit is {}.",
                instructions.len(),
                policy.max_instructions
            ));
            empty_instructions
        }
        Some(instructions) => instructions,
        None => {
            errors.push("Program is missing instructions.".to_owned());
            empty_instructions
        }
    };

    let allowed: BTreeSet<&str> = policy
        .allowed_operations
        .iter()
        .map(String::as_str)
        .collect();

    for (index, instruction) in instructions.iter().enumerate() {
        validate_instruction(index, instruction, policy, &allowed, &mut errors);
    }

    finish_validation(errors, policy)
}

fn finish_validation(errors: Vec<String>, policy: &Policy) -> ValidationReport {
    ValidationReport {
        ok: errors.is_empty(),
        errors,
        policy_version: policy.version,
    }
}

fn validate_instruction(
    index: usize,
    instruction: &Value,
    policy: &Policy,
    allowed: &BTreeSet<&str>,
    errors: &mut Vec<String>,
) {
    let Some(object) = instruction.as_object() else {
        errors.push(format!("Instruction {index} must be an object."));
        return;
    };

    let Some(op) = object.get("op").and_then(Value::as_str) else {
        errors.push(format!("Instruction {index} is missing op."));
        return;
    };

    if !allowed.contains(op) {
        errors.push(format!("Instruction {index} uses disallowed op: {op}"));
        return;
    }

    let permitted_keys: &[&str] = match op {
        "push" => &["op", "value"],
        "load" => &["op", "key", "field"],
        "emit" => &["op", "key"],
        _ => &["op"],
    };

    for key in object.keys() {
        if !permitted_keys.contains(&key.as_str()) {
            errors.push(format!(
                "Instruction {index} has unexpected field for {op}: {key}"
            ));
        }
    }

    match op {
        "push" => match object.get("value") {
            Some(value) if value.is_array() || value.is_object() => {
                errors.push(format!("Instruction {index} push value must be a JSON scalar."));
            }
            Some(value) => {
                let bytes = serde_json::to_vec(value).map(|bytes| bytes.len()).unwrap_or(usize::MAX);
                if bytes > policy.max_value_bytes {
                    errors.push(format!(
                        "Instruction {index} value is {bytes} bytes; limit is {}.",
                        policy.max_value_bytes
                    ));
                }
            }
            None => errors.push(format!("Instruction {index} push is missing value.")),
        },
        "load" => {
            match object.get("key").and_then(Value::as_str) {
                Some(key) if ALLOWED_INPUT_KEYS.contains(&key) => {}
                Some(key) => errors.push(format!("Instruction {index} cannot load key: {key}")),
                None => errors.push(format!("Instruction {index} load is missing key.")),
            }
            if let Some(field) = object.get("field") {
                match field.as_str() {
                    Some(field) if is_valid_emit_key(field) => {}
                    Some(_) => errors.push(format!("Instruction {index} has an invalid input field.")),
                    None => errors.push(format!("Instruction {index} field must be a string.")),
                }
            }
        }
        "emit" => match object.get("key").and_then(Value::as_str) {
            Some(key) if is_valid_emit_key(key) => {}
            Some(_) => errors.push(format!("Instruction {index} has an invalid emit key.")),
            None => errors.push(format!("Instruction {index} emit is missing key.")),
        },
        _ => {}
    }
}

fn required_string<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
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
    // Exactly MAJOR.MINOR.PATCH. The previous check also accepted "1" and "1.2".
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn is_valid_emit_key(key: &str) -> bool {
    if key.is_empty() || key.len() > EMIT_KEY_MAX_LEN || !key.chars().next().is_some_and(|c| c.is_ascii_lowercase()) {
        return false;
    }
    key.chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '_' | '.' | '-'))
}

/// Executes a validated deterministic program. Every operation is pure and
/// bounded by the fixed policy.
pub fn execute_program(manifest: &Value, input: &Value, policy: &Policy) -> ExecutionResult {
    let validation = validate_manifest(manifest, policy);
    if !validation.ok {
        return ExecutionResult {
            ok: false,
            outputs: json!({}),
            instructions_executed: 0,
            errors: validation.errors,
            policy_version: policy.version,
        };
    }

    let instructions = manifest
        .get("program")
        .and_then(Value::as_object)
        .and_then(|program| program.get("instructions"))
        .and_then(Value::as_array)
        .expect("validated program has instructions");

    let mut stack: Vec<Value> = Vec::new();
    let mut outputs = Map::new();
    let mut executed = 0usize;
    let mut errors = Vec::new();

    for (index, instruction) in instructions.iter().enumerate() {
        let op = instruction
            .get("op")
            .and_then(Value::as_str)
            .expect("validated instruction has op");

        if executed >= policy.max_instructions {
            errors.push(format!("Instruction limit reached at index {index}."));
            break;
        }

        let outcome: Result<Option<Value>, String> = match op {
            "push" => {
                let value = instruction
                    .get("value")
                    .cloned()
                    .expect("validated push has value");
                push_value(&mut stack, value, policy.max_stack_items)
            }
            "load" => {
                let key = instruction
                    .get("key")
                    .and_then(Value::as_str)
                    .expect("validated load has key");
                let value = if key == "input" {
                    match instruction.get("field").and_then(Value::as_str) {
                        Some(field) => input.get(field).cloned().unwrap_or(Value::Null),
                        None => input.clone(),
                    }
                } else {
                    Value::Null
                };
                let bytes = serde_json::to_vec(&value)
                    .map(|encoded| encoded.len())
                    .unwrap_or(usize::MAX);
                if bytes > policy.max_value_bytes {
                    Err(format!(
                        "Loaded value is {bytes} bytes; limit is {}.",
                        policy.max_value_bytes
                    ))
                } else {
                    push_value(&mut stack, value, policy.max_stack_items)
                }
            }
            "add" | "sub" | "mul" => arithmetic(op, &mut stack),
            "concat" => concat(&mut stack, policy.max_value_bytes),
            "emit" => {
                let key = instruction
                    .get("key")
                    .and_then(Value::as_str)
                    .expect("validated emit has key")
                    .to_owned();
                emit(&mut stack, &mut outputs, key, policy.max_output_bytes)
            }
            "return" => Ok(None),
            _ => Err(format!("Instruction {index} uses unexpected op: {op}")),
        };

        executed += 1;

        match outcome {
            Ok(_) => {}
            Err(message) => {
                errors.push(format!("Instruction {index} failed: {message}"));
                break;
            }
        }

        if op == "return" {
            break;
        }
    }

    ExecutionResult {
        ok: errors.is_empty(),
        outputs: Value::Object(outputs),
        instructions_executed: executed,
        errors,
        policy_version: policy.version,
    }
}

fn push_value(stack: &mut Vec<Value>, value: Value, limit: usize) -> Result<Option<Value>, String> {
    if stack.len() >= limit {
        return Err(format!("Stack limit ({limit}) exceeded."));
    }
    stack.push(value);
    Ok(None)
}

fn arithmetic(op: &str, stack: &mut Vec<Value>) -> Result<Option<Value>, String> {
    let right = stack.pop().ok_or_else(|| format!("{op} needs two stack values."))?;
    let left = stack.pop().ok_or_else(|| format!("{op} needs two stack values."))?;
    let left = left.as_i64().ok_or_else(|| format!("{op} needs integer values."))?;
    let right = right.as_i64().ok_or_else(|| format!("{op} needs integer values."))?;

    let result = match op {
        "add" => left.checked_add(right),
        "sub" => left.checked_sub(right),
        "mul" => left.checked_mul(right),
        _ => None,
    }
    .ok_or_else(|| format!("{op} overflowed."))?;

    stack.push(Value::from(result));
    Ok(None)
}

fn concat(stack: &mut Vec<Value>, max_value_bytes: usize) -> Result<Option<Value>, String> {
    let right = stack.pop().ok_or_else(|| "concat needs two stack values.")?;
    let left = stack.pop().ok_or_else(|| "concat needs two stack values.")?;
    let left = left.as_str().ok_or_else(|| "concat needs string values.")?;
    let right = right.as_str().ok_or_else(|| "concat needs string values.")?;
    let value = format!("{left}{right}");
    if value.len() > max_value_bytes {
        return Err(format!(
            "concat result is {} bytes; limit is {max_value_bytes}.",
            value.len()
        ));
    }
    stack.push(Value::String(value));
    Ok(None)
}

fn emit(
    stack: &mut Vec<Value>,
    outputs: &mut Map<String, Value>,
    key: String,
    max_output_bytes: usize,
) -> Result<Option<Value>, String> {
    let value = stack.pop().ok_or_else(|| "emit needs one stack value.")?;
    let mut next = outputs.clone();
    next.insert(key, value);
    let bytes = serde_json::to_vec(&next)
        .map(|encoded| encoded.len())
        .unwrap_or(usize::MAX);
    if bytes > max_output_bytes {
        return Err(format!(
            "Output is {bytes} bytes; limit is {max_output_bytes}."
        ));
    }
    *outputs = next;
    Ok(None)
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
