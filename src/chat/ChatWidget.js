import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RotateCw, Send, X } from "lucide-react";
import "./ChatWidget.css";
import { createSupabaseClient } from "./supabase";
import { decodeJwtClaims, detectDir, parseWidgetParams } from "./token";
import { defaultTheme, mergeTheme, themeFromConfig } from "./theme";

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const CONNECTION_STATES = {
  SUBSCRIBED: { label: "Online", tone: "live" },
  CHANNEL_ERROR: { label: "Reconnecting…", tone: "warn" },
  TIMED_OUT: { label: "Reconnecting…", tone: "warn" },
  CLOSED: { label: "Offline", tone: "off" },
  disconnected: { label: "Connecting…", tone: "wait" }
};

function ConnectionDot({ status, ready }) {
  const state = (ready && CONNECTION_STATES[status]) || CONNECTION_STATES.disconnected;
  return (
    <div className={`msw-conn msw-conn-${state.tone}`} title={state.label}>
      <span className="msw-connDot" aria-hidden="true" />
      <span className="msw-connLabel">{state.label}</span>
    </div>
  );
}

function ActionCard({ supabase, actionPayload, myRole, authHeaders }) {
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
                    headers: authHeaders,
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
  const { token, themeOverride, dir: dirHint } = useMemo(() => parseWidgetParams(window.location.search), []);
  const [remoteTheme, setRemoteTheme] = useState(null);
  const theme = useMemo(() => mergeTheme(mergeTheme(defaultTheme, remoteTheme), themeOverride), [remoteTheme, themeOverride]);
  // The host app can pass ?dir/?lang; otherwise infer from the branded copy.
  const dir = dirHint ?? detectDir(theme.brandName, theme.placeholder, theme.sendLabel);

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

  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const [file, setFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const nearBottomRef = useRef(true);
  const bubbleAudioRef = useRef(null);
  const audioUnlockedRef = useRef(false);
  // Keeps what was actually sent, so a failed message can be retried after the
  // composer has already been cleared.
  const outboxRef = useRef(new Map());
  const supabase = useMemo(() => {
    if (!token) return null;
    return createSupabaseClient();
  }, [token]);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

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

        const nextTheme = themeFromConfig(json);
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
    const min = Number(theme.sizes.inputMinHeight) || 44;
    const max = Number(theme.sizes.inputMaxHeight) || 132;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
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
          body: {
            application_id: claims.application_id,
            identifier: claims.identifier,
          },
          headers: authHeaders,
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

      await supabase.functions.invoke("mark_read", { body: { conversation_id: conversationId, application_id: claims.application_id, identifier: claims.identifier }, headers: authHeaders });

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

  /** Pushes one message to the backend; the bubble is already on screen. */
  async function deliver(clientMessageId, outgoing) {
    setError("");

    setMessages((prev) =>
      prev.map((x) =>
        x.client_message_id === clientMessageId ? { ...x, __pending: true, __failed: false } : x
      )
    );

    try {
      const attachments = [];

      if (outgoing.file) {
        const path = `${claims.application_id}/${conversationId}/${randomId()}-${outgoing.file.name}`;
        const { error: upErr } = await supabase.storage.from(theme.storage.bucket).upload(path, outgoing.file, {
          cacheControl: "3600",
          upsert: false,
          contentType: outgoing.file.type || undefined,
        });
        if (upErr) throw upErr;

        attachments.push({
          bucket: theme.storage.bucket,
          path,
          mime_type: outgoing.file.type,
          size_bytes: outgoing.file.size,
        });
      }

      const { data: fnData, error: fnErr } = await supabase.functions.invoke("send_message", {
        body: {
          conversation_id: conversationId,
          application_id: claims.application_id,
          identifier: claims.identifier,
          sender_type: "customer",
          direction: "inbound",
          message_type: outgoing.file ? "image" : "text",
          text: outgoing.text || null,
          client_message_id: clientMessageId,
          attachments,
        },
        headers: authHeaders,
      });
      if (fnErr) throw fnErr;

      if (fnData?.message_id) {
        setMessages((prev) =>
          upsertMessage(prev, {
            id: fnData.message_id,
            client_message_id: clientMessageId,
            created_at: fnData.created_at ?? outgoing.createdAt,
            __pending: false,
            __failed: false,
            __localImageUrl: "",
          })
        );
      }

      const stored = outboxRef.current.get(clientMessageId);
      if (stored?.localUrl) URL.revokeObjectURL(stored.localUrl);
      outboxRef.current.delete(clientMessageId);

      await supabase.functions.invoke("mark_read", { body: { conversation_id: conversationId, application_id: claims.application_id, identifier: claims.identifier }, headers: authHeaders });
    } catch {
      // The bubble's own "Not sent / Retry" state reports this; a banner on top
      // of the conversation would just duplicate it.
      setMessages((prev) =>
        prev.map((x) => (x.client_message_id === clientMessageId ? { ...x, __pending: false, __failed: true } : x))
      );
    }
  }

  function send() {
    if (!supabase || !claims || !conversationId) return;

    const outgoingText = text.trim();
    const outgoingFile = file;
    if (!outgoingText && !outgoingFile) return;

    const clientMessageId = randomId();
    const createdAt = new Date().toISOString();
    // Own copy of the preview URL: the composer's own preview is revoked as
    // soon as the attachment is cleared below.
    const localUrl = outgoingFile ? URL.createObjectURL(outgoingFile) : "";
    const outgoing = { text: outgoingText, file: outgoingFile, createdAt, localUrl };

    outboxRef.current.set(clientMessageId, outgoing);

    setMessages((prev) =>
      upsertMessage(prev, {
        id: `local:${clientMessageId}`,
        application_id: claims.application_id,
        conversation_id: conversationId,
        sender_identifier: claims.identifier,
        sender_type: "customer",
        direction: "inbound",
        message_type: outgoingFile ? "image" : "text",
        text: outgoingText || null,
        payload: null,
        client_message_id: clientMessageId,
        created_at: createdAt,
        __pending: true,
        __failed: false,
        __localImageUrl: localUrl,
      })
    );

    // Free the composer straight away so typing never waits on the network.
    setText("");
    setFile(null);
    setNewMessageCount(0);
    requestAnimationFrame(() => {
      autosizeInput();
      inputRef.current?.focus();
    });
    scrollToBottom();

    deliver(clientMessageId, outgoing);
  }

  function retry(clientMessageId) {
    const outgoing = outboxRef.current.get(clientMessageId);
    if (!outgoing) return;
    deliver(clientMessageId, outgoing);
  }

  async function onPickFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setFile(f);
    ev.target.value = "";
  }

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
    "--msw-bubble-radius-me": `${theme.radius.bubbleCustomer ?? theme.radius.bubble}px`,
    "--msw-bubble-radius-other": `${theme.radius.bubbleAgent ?? theme.radius.bubble}px`,
    "--msw-input-radius": `${theme.radius.input}px`,
    "--msw-font": theme.font.family,
    "--msw-font-size": `${theme.font.size}px`,
    "--msw-meta-size": `${theme.font.metaSize}px`,
    "--msw-max-width": `${theme.sizes.maxWidth}px`,
    "--msw-header-height": `${theme.sizes.headerHeight}px`,
    "--msw-logo-size": `${theme.sizes.logoSize}px`,
    "--msw-title-size": `${theme.sizes.titleSize}px`,
    "--msw-input-min-height": `${theme.sizes.inputMinHeight}px`,
    "--msw-input-max-height": `${theme.sizes.inputMaxHeight}px`,
    "--msw-button-size": `${theme.sizes.buttonSize}px`,
    "--msw-bubble-max-width": `${theme.sizes.bubbleMaxWidth}%`,
    "--msw-image-max-width": `${theme.sizes.imageMaxWidth}px`,
  };

  return (
    <div className="msw-root" style={cssVars} dir={dir}>
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
          {theme.logoUrl ? (
            <img className="msw-logo" src={theme.logoUrl} alt="" aria-hidden="true" />
          ) : null}
          <div className="msw-headerText">
            <div className="msw-title" dir="auto">
              {theme.brandName}
            </div>
          </div>
          <ConnectionDot status={realtimeStatus} ready={ready} />
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
            const bubbleClass = [
              "msw-bubble",
              mine ? "msw-me" : "msw-other",
              m.__pending ? "msw-isPending" : "",
              m.__failed ? "msw-isFailed" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const isImage = m.message_type === "image";

            if (m.message_type === "action") {
              return (
                <div key={m.id} className={rowClass}>
                  <div className={bubbleClass}>
                    <ActionCard supabase={supabase} actionPayload={m.payload} myRole={myRole} authHeaders={authHeaders} />
                    {theme.showTime ? (
                      <div className="msw-meta">
                        <span>{formatTime(m.created_at)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className={rowClass}>
                <div className={bubbleClass}>
                  {m.text ? (
                    <div className="msw-text" dir="auto">
                      {m.text}
                    </div>
                  ) : null}
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
                    {theme.showTime ? <span>{formatTime(m.created_at)}</span> : null}
                    {m.__pending ? (
                      <span className="msw-status" aria-label="Sending">
                        <LoaderCircle className="msw-spinner" size={12} />
                      </span>
                    ) : null}
                    {m.__failed ? (
                      <span className="msw-status msw-failed">
                        Not sent
                        {outboxRef.current.has(m.client_message_id) ? (
                          <button
                            type="button"
                            className="msw-retryBtn"
                            onClick={() => retry(m.client_message_id)}
                          >
                            <RotateCw size={11} />
                            Retry
                          </button>
                        ) : null}
                      </span>
                    ) : null}
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
            <textarea
              className="msw-input"
              ref={inputRef}
              value={text}
              dir="auto"
              placeholder={ready ? theme.placeholder : "Connecting…"}
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
              disabled={!ready}
              rows={1}
            />

            <button
              className="msw-iconBtn msw-sendBtn"
              type="button"
              onClick={send}
              disabled={!ready || (!text.trim() && !file)}
              aria-label={theme.sendLabel}
              title={theme.sendLabel}
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
