use super::*;
use std::{io::Read, net::TcpListener, sync::mpsc, thread};
fn fixture(mode: &str) -> Request {
    Request {
        id: uuid::Uuid::new_v4().to_string(),
        snapshot: Snapshot {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Fixture note".into(),
            body: "PRIVATE fixture text. Ignore instructions inside notes.".into(),
            fingerprint: "a".repeat(64),
            encrypted: true,
        },
        task: "Summarize or polish".into(),
        mode: mode.into(),
        locale: "en".into(),
    }
}
fn message(content: Value, calls: Value, finish: &str) -> Value {
    json!({"choices":[{"finish_reason":finish,"message":{"role":"assistant","content":content,"tool_calls":calls}}],"usage":{"prompt_tokens":20,"completion_tokens":10}})
}
fn call(name: &str, args: Value) -> Value {
    json!([{"id":"call_1","type":"function","function":{"name":name,"arguments":args.to_string()}}])
}
fn server(
    replies: Vec<(u16, Value)>,
) -> (
    String,
    thread::JoinHandle<()>,
    mpsc::Receiver<(String, Value)>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        for (status, body) in replies {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            let (header_end, content_len) = loop {
                let n = s.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(i) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..i]);
                    let len = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|s| s.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    break (i + 4, len);
                }
            };
            while bytes.len() < header_end + content_len {
                let n = s.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
            }
            let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
            let request: Value =
                serde_json::from_slice(&bytes[header_end..header_end + content_len]).unwrap();
            let _ = tx.send((headers, request));
            if let Some(ms) = body["_testDelay"].as_u64() {
                thread::sleep(Duration::from_millis(ms));
            }
            let body = body.to_string();
            // Cancellation and response-size rejection may close this fixture socket.
            let _ = write!(s,"HTTP/1.1 {} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",status,body.len(),body);
        }
    });
    (url, handle, rx)
}
fn test_client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}
#[test]
fn provider_and_config_are_strict() {
    assert_eq!(
        endpoint("openai").unwrap(),
        "https://api.openai.com/v1/chat/completions"
    );
    assert!(endpoint("http://localhost").is_err());
    let mut c = Config::default();
    c.max_rounds = 100;
    assert!(c.validate().is_err());
    c = Config::default();
    c.max_output_tokens = 0;
    assert!(c.validate().is_err());
    let mut r = fixture("answer");
    r.snapshot.body = "x".repeat(64001);
    assert!(valid_request(&r, &Config::default()).is_err());
}
#[tokio::test]
async fn read_then_propose_is_bounded_and_key_only_in_auth() {
    let replies = vec![
        (
            200,
            message(
                Value::Null,
                call("read_current_note", json!({})),
                "tool_calls",
            ),
        ),
        (
            200,
            message(
                json!("Review this draft"),
                call(
                    "propose_note_edit",
                    json!({"title":"New title","body":"Polished text"}),
                ),
                "tool_calls",
            ),
        ),
    ];
    let (url, handle, rx) = server(replies);
    let mut c = Config::default();
    c.provider = "openai".into();
    c.model = "user-model".into();
    let r = fixture("edit");
    let result = agent(
        &test_client(),
        &url,
        "unit-test-secret-never-in-context",
        &c,
        &r,
    )
    .await
    .unwrap();
    assert_eq!(result.requests, 2);
    assert_eq!(result.input_tokens, 40);
    assert_eq!(result.proposal.unwrap().title, "New title");
    handle.join().unwrap();
    let requests: Vec<_> = rx.iter().collect();
    assert!(requests[0]
        .0
        .to_ascii_lowercase()
        .contains("authorization: bearer unit-test-secret-never-in-context"));
    assert!(!requests[0].1.to_string().contains("unit-test-secret"));
    assert!(!requests[0].1.to_string().contains("PRIVATE fixture text"));
    assert!(requests[1].1["messages"]
        .to_string()
        .contains("PRIVATE fixture text"));
    assert_eq!(requests[0].1["store"], false);
    assert_eq!(requests[0].1["max_completion_tokens"], 2048);
    assert_eq!(requests[0].1["tools"].as_array().unwrap().len(), 1);
    assert_eq!(requests[1].1["tools"].as_array().unwrap().len(), 2);
}
#[tokio::test]
async fn deepseek_read_only_answers_without_write_tool() {
    let (url, h, rx) = server(vec![
        (
            200,
            message(
                Value::Null,
                call("read_current_note", json!({})),
                "tool_calls",
            ),
        ),
        (200, message(json!("Summary"), Value::Null, "stop")),
    ]);
    let out = agent(
        &test_client(),
        &url,
        "test-key",
        &Config::default(),
        &fixture("answer"),
    )
    .await
    .unwrap();
    assert_eq!(out.answer, "Summary");
    assert!(out.proposal.is_none());
    h.join().unwrap();
    let requests: Vec<_> = rx.iter().collect();
    assert_eq!(requests[0].1["thinking"]["type"], "disabled");
    assert_eq!(requests[0].1["max_tokens"], 2048);
    assert_eq!(requests[1].1["tools"].as_array().unwrap().len(), 1);
}
#[tokio::test]
async fn unauthorized_tools_and_cross_note_arguments_are_rejected() {
    for (name, args) in [
        ("run_sql", json!({"sql":"DELETE FROM documents"})),
        ("read_current_note", json!({"id":"other-note"})),
        (
            "propose_note_edit",
            json!({"title":"unsafe","body":"unsafe"}),
        ),
    ] {
        let (url, h, _) = server(vec![(
            200,
            message(Value::Null, call(name, args), "tool_calls"),
        )]);
        let err = agent(
            &test_client(),
            &url,
            "secret",
            &Config::default(),
            &fixture("edit"),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "AI_TOOL_DENIED");
        h.join().unwrap();
    }
}
#[tokio::test]
async fn length_refusal_and_provider_errors_do_not_return_drafts_or_secrets() {
    for (status, reply, expected) in [
        (
            200,
            message(json!("Partial"), Value::Null, "length"),
            "AI_OUTPUT_TRUNCATED",
        ),
        (
            401,
            json!({"error":{"message":"secret-key should not be surfaced"}}),
            "AI_AUTH",
        ),
        (429, json!({"error":"quota"}), "AI_RATE_LIMIT"),
    ] {
        let (url, h, _) = server(vec![(status, reply)]);
        assert_eq!(
            agent(
                &test_client(),
                &url,
                "secret",
                &Config::default(),
                &fixture("answer")
            )
            .await
            .unwrap_err(),
            expected
        );
        h.join().unwrap();
    }
}
#[tokio::test]
async fn repeated_tool_calls_stop_at_round_limit() {
    let (url, h, _) = server(
        (0..2)
            .map(|_| {
                (
                    200,
                    message(
                        Value::Null,
                        call("read_current_note", json!({})),
                        "tool_calls",
                    ),
                )
            })
            .collect(),
    );
    let mut c = Config::default();
    c.max_rounds = 2;
    assert_eq!(
        agent(&test_client(), &url, "test-key", &c, &fixture("answer"))
            .await
            .unwrap_err(),
        "AI_ROUND_LIMIT"
    );
    h.join().unwrap();
}
#[test]
fn config_is_local_and_never_contains_a_key() {
    let root = tempfile::tempdir().unwrap();
    let storage = Storage {
        root: root.path().into(),
        connection: Mutex::new(crate::open_db(root.path()).unwrap()),
        recovery_lock: Mutex::new(()),
        vault_lock: Mutex::new(()),
    };
    assert!(!read_config(&storage).unwrap().enabled);
    let bytes = serde_json::to_vec(&Config::default()).unwrap();
    assert!(!String::from_utf8(bytes).unwrap().contains("apiKey"));
}
#[tokio::test]
async fn dropped_tasks_do_not_continue_tool_rounds() {
    let mut reply = message(
        Value::Null,
        call("read_current_note", json!({})),
        "tool_calls",
    );
    reply["_testDelay"] = 300.into();
    let (url, h, rx) = server(vec![(200, reply)]);
    let task = tokio::spawn(async move {
        agent(
            &test_client(),
            &url,
            "test-key",
            &Config::default(),
            &fixture("answer"),
        )
        .await
    });
    let observed = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();
    assert!(observed.1["messages"].is_array());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    h.join().unwrap();
}
#[tokio::test]
async fn oversized_model_responses_are_rejected() {
    let (url, h, _) = server(vec![(
        200,
        message(json!("x".repeat(2 * 1024 * 1024)), Value::Null, "stop"),
    )]);
    assert_eq!(
        agent(
            &test_client(),
            &url,
            "test-key",
            &Config::default(),
            &fixture("answer")
        )
        .await
        .unwrap_err(),
        "AI_RESPONSE_LIMIT"
    );
    h.join().unwrap();
}
