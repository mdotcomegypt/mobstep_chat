import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import "./ChatWidget.css";
import { createAuthedSupabaseClient } from "./supabase";
import { decodeJwtClaims, parseWidgetParams } from "./token";
import { defaultTheme, mergeTheme } from "./theme";

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function ActionCard({ supabase, actionPayload, myRole }) {
  const actionId = actionPayload && typeof actionPayload === "object" ? actionPayload.action_id : null;
  const [action, setAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    if (!actionId) return;
    let active = true;

    (async () => {
      const { data, error } = await supabase
        .from("conversation_actions")
        .select("id, status, assigned_to, input")
        .eq("id", actionId)
        .maybeSingle();

      if (!active) return;
      if (error || !data) return;
      setAction(data);
    })();

    return () => {
      active = false;
    };
  }, [supabase, actionId]);

  const input = action?.input && typeof action.input === "object" ? action.input : {};
  const title = input.title || "Action required";
  const description = input.description || "";
  const changes = Array.isArray(input.changes) ? input.changes : [];
  const ctas = Array.isArray(input.ctas) ? input.ctas : [];

  const canAct = action?.status === "pending" && action?.assigned_to === myRole;

  return (
    <div className="msw-actionCard">
      <div className="msw-actionTitle">{title}</div>
      {description ? <div className="msw-actionDesc">{description}</div> : null}
      {changes.length > 0 ? (
        <div className="msw-actionChanges">
          {changes.map((c, idx) => (
            <div key={idx} className="msw-actionChange">
              <span className="msw-actionItem">{String(c.item ?? "")}</span>
              <span className="msw-actionDelta">
                {String(c.from ?? "")} → {String(c.to ?? "")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {ctas.length > 0 ? (
        <div className="msw-actionCtas">
          {ctas.map((cta) => {
            const id = String(cta.id ?? "");
            const label = String(cta.label ?? id);

            return (
              <button
                key={id}
                type="button"
                className={id === "accept" ? "msw-actionBtn msw-actionPrimary" : "msw-actionBtn"}
                disabled={!canAct || submitting}
                onClick={async () => {
                  if (!supabase || !actionId) return;
                  setSubmitting(true);
                  const { error } = await supabase.functions.invoke("submit_action", {
                    body: {
                      action_id: actionId,
                      result: { cta_id: id, url: cta.url ?? null },
                      message_direction: myRole === "agent" ? "outbound" : "inbound",
                    },
                  });

                  if (!error) {
                    const { data } = await supabase
                      .from("conversation_actions")
                      .select("id, status, assigned_to, input")
                      .eq("id", actionId)
                      .maybeSingle();
                    if (data) setAction(data);
                  }
                  setSubmitting(false);
                }}
              >
                {submitting ? "Submitting..." : label}
              </button>
            );
          })}
        </div>
      ) : null}

      {action?.status && action.status !== "pending" ? (
        <div className="msw-actionStatus">Status: {action.status}</div>
      ) : null}
      {!canAct && action?.status === "pending" ? (
        <div className="msw-actionStatus">Waiting for {action.assigned_to}</div>
      ) : null}
    </div>
  );
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function upsertMessage(list, msg) {
  const idx = list.findIndex((m) => (msg.client_message_id && m.client_message_id === msg.client_message_id) || m.id === msg.id);
  if (idx === -1) return [...list, msg];
  const next = list.slice();
  next[idx] = { ...next[idx], ...msg, __pending: false, __failed: false };
  return next;
}

export default function ChatWidget() {
  const { token, themeOverride } = useMemo(() => parseWidgetParams(window.location.search), []);
  const [remoteTheme, setRemoteTheme] = useState(null);
  const theme = useMemo(() => mergeTheme(mergeTheme(defaultTheme, remoteTheme), themeOverride), [remoteTheme, themeOverride]);

  const [modalImageUrl, setModalImageUrl] = useState("");

  const claims = useMemo(() => {
    if (!token) return null;
    try {
      return decodeJwtClaims(token);
    } catch {
      return null;
    }
  }, [token]);

  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState("disconnected");

  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [myRole, setMyRole] = useState("customer");

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const [file, setFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const nearBottomRef = useRef(true);
  const bubbleAudioRef = useRef(null);
  const audioUnlockedRef = useRef(false);
  const supabase = useMemo(() => {
    if (!token) return null;
    return createAuthedSupabaseClient(token);
  }, [token]);

  useEffect(() => {
    if (!claims?.application_id) return;

    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        const url = `https://mobstep.com/api/customer-support/config/${encodeURIComponent(String(claims.application_id))}/en`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to load app config (${res.status})`);
        const json = await res.json();
        if (!active) return;

        const nextTheme = json?.theme && typeof json.theme === "object" ? json.theme : null;
        if (nextTheme) setRemoteTheme(nextTheme);
      } catch {
        // ignore and keep defaults
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [claims]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!modalImageUrl) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") setModalImageUrl("");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalImageUrl]);

  useEffect(() => {
    nearBottomRef.current = isNearBottom;
  }, [isNearBottom]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (!listRef.current) return;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }

  function handleListScroll() {
    if (!listRef.current) return;
    const el = listRef.current;
    const threshold = 120;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    const nearBottom = distance <= threshold;
    setIsNearBottom(nearBottom);
    if (nearBottom) setNewMessageCount(0);
  }

  function autosizeInput() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 120;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  useEffect(() => {
    if (bubbleAudioRef.current) return;
    bubbleAudioRef.current = new Audio("/bubble.mp3");

    const unlock = async () => {
      if (audioUnlockedRef.current) return;
      try {
        const a = bubbleAudioRef.current;
        if (!a) return;
        a.volume = 0;
        await a.play();
        a.pause();
        a.currentTime = 0;
        a.volume = 1;
        audioUnlockedRef.current = true;
      } catch {
        // ignore autoplay restrictions until user gesture succeeds
      }
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  async function playBubble() {
    try {
      const a = bubbleAudioRef.current;
      if (!a) return;
      a.currentTime = 0;
      await a.play();
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!token) {
      setError("Access denied");
      return;
    }
    if (!supabase || !claims) {
      setError("Invalid token");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setError("");
        const { data, error: fnErr } = await supabase.functions.invoke("create_or_get_conversation", {
          body: {},
        });
        if (fnErr) throw fnErr;
        if (!data?.conversation_id) throw new Error("Missing conversation_id");
        if (cancelled) return;

        setConversationId(data.conversation_id);
        setReady(true);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(m);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, supabase, claims]);

  useEffect(() => {
    if (!supabase || !conversationId || !claims) return;

    let active = true;

    (async () => {
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_identifier, sender_type, direction, message_type, text, payload, client_message_id, created_at")
        .eq("application_id", claims.application_id)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (!active) return;
      if (error) {
        setError(error.message);
        setLoadingMessages(false);
        return;
      }
      setMessages(data ?? []);

      await supabase.functions.invoke("mark_read", { body: { conversation_id: conversationId } });

      setLoadingMessages(false);

      scrollToBottom();
    })();

    const channel = supabase
      .channel(`chat:${claims.application_id}:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new;
          setMessages((prev) => upsertMessage(prev, row));

          const isMine = row.sender_identifier === claims?.identifier;
          const isIncomingToCustomer = row.direction === "outbound" && row.sender_type === "agent";
          if (!isMine && isIncomingToCustomer) {
            playBubble();
          }

          if (nearBottomRef.current) {
            scrollToBottom();
          } else {
            setNewMessageCount((c) => c + 1);
          }
        }
      )
      .subscribe((status) => {
        if (!active) return;
        setRealtimeStatus(status);
      });

    return () => {
      active = false;
      setRealtimeStatus("disconnected");
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, claims]);

  useEffect(() => {
    if (!supabase || !claims || !conversationId) return;
    let active = true;

    (async () => {
      const { data, error } = await supabase
        .from("conversation_participants")
        .select("role")
        .eq("application_id", claims.application_id)
        .eq("conversation_id", conversationId)
        .eq("identifier", claims.identifier)
        .maybeSingle();

      if (!active) return;
      if (error || !data?.role) return;
      setMyRole(data.role);
    })();

    return () => {
      active = false;
    };
  }, [supabase, claims, conversationId]);

  async function send() {
    if (!supabase || !claims || !conversationId) return;
    if (!text.trim() && !file) return;
    if (sending) return;

    setSending(true);
    setError("");

    const clientMessageId = randomId();
    const localId = `local:${clientMessageId}`;
    const nowIso = new Date().toISOString();

    const optimistic = {
      id: localId,
      application_id: claims.application_id,
      conversation_id: conversationId,
      sender_identifier: claims.identifier,
      sender_type: "customer",
      direction: "inbound",
      message_type: file ? "image" : "text",
      text: text.trim() ? text.trim() : null,
      payload: null,
      client_message_id: clientMessageId,
      created_at: nowIso,
      __pending: true,
      __failed: false,
      __localImageUrl: file ? filePreviewUrl : "",
    };

    setMessages((prev) => upsertMessage(prev, optimistic));
    setNewMessageCount(0);
    scrollToBottom();

    try {
      const attachments = [];

      if (file) {
        const path = `${claims.application_id}/${conversationId}/${randomId()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from(theme.storage.bucket).upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (upErr) throw upErr;

        attachments.push({
          bucket: theme.storage.bucket,
          path,
          mime_type: file.type,
          size_bytes: file.size,
        });
      }

      const messageType = file ? "image" : "text";

      const { data: fnData, error: fnErr } = await supabase.functions.invoke("send_message", {
        body: {
          conversation_id: conversationId,
          sender_type: "customer",
          direction: "inbound",
          message_type: messageType,
          text: text.trim() ? text.trim() : null,
          client_message_id: clientMessageId,
          attachments,
        },
      });
      if (fnErr) throw fnErr;

      if (fnData?.message_id) {
        setMessages((prev) =>
          upsertMessage(prev, {
            id: fnData.message_id,
            client_message_id: clientMessageId,
            created_at: fnData.created_at ?? nowIso,
            __pending: false,
            __failed: false,
            __localImageUrl: "",
          })
        );
      }

      setText("");
      setFile(null);
      autosizeInput();
      await supabase.functions.invoke("mark_read", { body: { conversation_id: conversationId } });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);

      setMessages((prev) =>
        prev.map((x) => (x.client_message_id === clientMessageId ? { ...x, __pending: false, __failed: true } : x))
      );
    } finally {
      setSending(false);
    }
  }

  async function onPickFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setFile(f);
    ev.target.value = "";
  }

  const identifierShort = claims?.identifier ? String(claims.identifier).slice(-6) : "";

  useEffect(() => {
    autosizeInput();
  }, [text]);

  const cssVars = {
    "--msw-bg": theme.colors.background,
    "--msw-header-bg": theme.colors.header,
    "--msw-header-text": theme.colors.headerText,
    "--msw-bubble-me": theme.colors.bubbleCustomer,
    "--msw-bubble-other": theme.colors.bubbleAgent,
    "--msw-bubble-text": theme.colors.bubbleText,
    "--msw-bubble-subtle": theme.colors.bubbleSubtleText,
    "--msw-input-bg": theme.colors.inputBg,
    "--msw-input-text": theme.colors.inputText,
    "--msw-input-border": theme.colors.inputBorder ?? theme.colors.border,
    "--msw-border": theme.colors.border,
    "--msw-accent": theme.colors.accent,
    "--msw-btn-text": theme.colors.buttonText,
    "--msw-btn-icon": theme.colors.buttonIcon,
    "--msw-btn-border": theme.colors.buttonBorder,
    "--msw-footer-bg": theme.colors.footerBg,
    "--msw-danger": theme.colors.danger,
    "--msw-container-radius": `${theme.radius.container}px`,
    "--msw-bubble-radius": `${theme.radius.bubble}px`,
    "--msw-input-radius": `${theme.radius.input}px`,
  };

  return (
    <div className="msw-root" style={cssVars}>
      {modalImageUrl ? (
        <div
          className="msw-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setModalImageUrl("")}
        >
          <img className="msw-modalImg" src={modalImageUrl} alt="preview" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
      <div className="msw-shell">
        <div className="msw-header">
          <div>
            <div className="msw-title">{theme.brandName}</div>
            <div className="msw-subtitle">App {claims?.application_id ?? "-"} • {identifierShort}</div>
          </div>
          {ready && realtimeStatus !== "SUBSCRIBED" ? (
            <div className="msw-subtitle">Live: {realtimeStatus}</div>
          ) : null}
          {ready ? (
            <button
              type="button"
              className="msw-headerBtn"
              onClick={async () => {
                if (!supabase || !conversationId) return;
                setError("");
                const body = {
                  conversation_id: conversationId,
                  action_key: "order_change_acceptance",
                  assigned_to: myRole === "agent" ? "customer" : "agent",
                  input: {
                    title: "Order items change",
                    description: "The order items were changed. Please accept or reject.",
                    changes: [
                      { item: "Burger", from: 1, to: 2 },
                      { item: "Fries", from: 0, to: 1 },
                    ],
                    ctas: [
                      { id: "accept", label: "Accept", url: "https://example.com/accept" },
                      { id: "reject", label: "Reject", url: "https://example.com/reject" },
                    ],
                  },
                  message_direction: myRole === "agent" ? "outbound" : "inbound",
                };

                const { error: fnErr } = await supabase.functions.invoke("create_action", { body });
                if (fnErr) setError(fnErr.message);
              }}
            >
              Simulate action
            </button>
          ) : null}
        </div>

        {!!error && <div className="msw-error">{error}</div>}

        <div className="msw-messages" ref={listRef} onScroll={handleListScroll}>
          {loadingMessages ? (
            <div className="msw-subtitle">Loading…</div>
          ) : null}

          {!loadingMessages && messages.length === 0 && ready ? (
            <div className="msw-subtitle">No messages yet</div>
          ) : null}

          {newMessageCount > 0 ? (
            <button
              type="button"
              className="msw-newMsgBtn"
              onClick={() => {
                setNewMessageCount(0);
                scrollToBottom();
              }}
            >
              New messages ({newMessageCount})
            </button>
          ) : null}

          {messages.map((m) => {
            const mine = m.sender_identifier === claims?.identifier;
            const rowClass = mine ? "msw-bubbleRow msw-me" : "msw-bubbleRow msw-other";
            const bubbleClass = mine ? "msw-bubble msw-me" : "msw-bubble msw-other";

            const isImage = m.message_type === "image";

            if (m.message_type === "action") {
              return (
                <div key={m.id} className={rowClass}>
                  <div className={bubbleClass}>
                    <ActionCard supabase={supabase} actionPayload={m.payload} myRole={myRole} />
                    <div className="msw-meta">
                      <span>{formatTime(m.created_at)}</span>
                      <span>{m.sender_type}</span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className={rowClass}>
                <div className={bubbleClass}>
                  {m.text ? <div>{m.text}</div> : null}
                  {isImage ? (
                    <div style={{ marginTop: m.text ? 8 : 0 }}>
                      {m.__pending && m.__localImageUrl ? (
                        <img
                          className="msw-img"
                          src={m.__localImageUrl}
                          alt="uploading"
                          onClick={() => setModalImageUrl(m.__localImageUrl)}
                        />
                      ) : (
                        <ImageAttachment supabase={supabase} messageId={m.id} onOpen={setModalImageUrl} />
                      )}
                    </div>
                  ) : null}
                  <div className="msw-meta">
                    <span>{formatTime(m.created_at)}</span>
                    <span>{m.sender_type}</span>
                    {m.__pending ? (
                      <span className="msw-status">
                        <LoaderCircle className="msw-spinner" size={14} />
                        Sending
                      </span>
                    ) : null}
                    {m.__failed ? <span className="msw-status msw-failed">Failed</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="msw-composer">
          {file && (
            <div className="msw-attachPreview">
              {filePreviewUrl ? (
                <img
                  className="msw-attachThumb"
                  src={filePreviewUrl}
                  alt="preview"
                  onClick={() => setModalImageUrl(filePreviewUrl)}
                />
              ) : null}
              <div className="msw-attachInfo">
                <div className="msw-attachName">{file.name}</div>
                <div className="msw-attachHint">Image will be attached</div>
              </div>
              <button className="msw-iconBtn" type="button" onClick={() => setFile(null)} aria-label="Remove attachment">
                <X size={18} />
              </button>
            </div>
          )}

          <div className="msw-composerRow">
            <label className="msw-iconBtn" style={{ cursor: sending ? "not-allowed" : "pointer" }}>
              <input type="file" accept="image/*" onChange={onPickFile} disabled={!ready || sending} style={{ display: "none" }} />
              <ImagePlus size={18} />
            </label>

            <textarea
              className="msw-input"
              ref={inputRef}
              value={text}
              placeholder={ready ? "Write a message..." : "Connecting..."}
              onChange={(e) => {
                setText(e.target.value);
                autosizeInput();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={!ready || sending}
              rows={1}
            />

            <button
              className="msw-iconBtn msw-sendBtn"
              type="button"
              onClick={send}
              disabled={!ready || sending || (!text.trim() && !file)}
              aria-label="Send"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageAttachment({ supabase, messageId, onOpen }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    setUrl("");

    if (!supabase) return;
    if (!messageId) return;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(messageId)
    );
    if (!isUuid) return;

    (async () => {
      const { data, error } = await supabase
        .from("message_attachments")
        .select("bucket, path")
        .eq("message_id", messageId)
        .limit(1)
        .maybeSingle();

      if (!active) return;
      if (error || !data) return;

      const { data: pub } = supabase.storage.from(data.bucket).getPublicUrl(data.path);
      if (pub?.publicUrl) setUrl(pub.publicUrl);
    })();

    return () => {
      active = false;
    };
  }, [supabase, messageId]);

  if (!url) return null;
  return (
    <img
      className="msw-img"
      src={url}
      alt="attachment"
      onClick={() => {
        if (onOpen) onOpen(url);
      }}
    />
  );
}
