import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getClaimsFromAuthHeader } from "../jwt-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

type Body = {
  conversation_id: string;
  action_key: string;
  assigned_to: "customer" | "agent";
  input?: unknown;
  message_direction?: "inbound" | "outbound";
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const authHeader = req.headers.get("authorization");
    const { application_id, identifier, token } = await getClaimsFromAuthHeader(authHeader);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase env vars");

    const user = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const admin = createClient(url, serviceKey);

    const body = (await req.json()) as Body;
    if (!body.conversation_id) throw new Error("conversation_id is required");
    if (!body.action_key) throw new Error("action_key is required");

    const { data: me, error: meErr } = await user
      .from("conversation_participants")
      .select("role")
      .eq("application_id", application_id)
      .eq("conversation_id", body.conversation_id)
      .eq("identifier", identifier)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) throw new Error("Not a participant");

    const { data: def, error: defErr } = await admin
      .from("action_definitions")
      .select("id, key")
      .eq("application_id", application_id)
      .eq("key", body.action_key)
      .eq("enabled", true)
      .single();
    if (defErr) throw defErr;

    const { data: action, error: actionErr } = await admin
      .from("conversation_actions")
      .insert({
        application_id,
        conversation_id: body.conversation_id,
        action_definition_id: def.id,
        assigned_to: body.assigned_to,
        input: body.input ?? null,
      })
      .select("id")
      .single();
    if (actionErr) throw actionErr;

    const direction = body.message_direction ?? "outbound";
    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .insert({
        application_id,
        conversation_id: body.conversation_id,
        sender_identifier: identifier,
        sender_type: me.role === "agent" ? "agent" : "customer",
        direction,
        message_type: "action",
        text: null,
        payload: { action_id: action.id, action_key: def.key },
      })
      .select("id")
      .single();
    if (msgErr) throw msgErr;

    const { error: linkErr } = await admin
      .from("conversation_actions")
      .update({ created_by_message_id: msg.id })
      .eq("id", action.id)
      .eq("application_id", application_id);
    if (linkErr) throw linkErr;

    return new Response(JSON.stringify({ action_id: action.id, message_id: msg.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
