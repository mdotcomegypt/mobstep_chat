import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getClaimsFromAuthHeader } from "../jwt-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const authHeader = req.headers.get("authorization");
    const { application_id, identifier } = await getClaimsFromAuthHeader(authHeader);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase env vars");

    const admin = createClient(url, serviceKey);

    const body = (await req.json().catch(() => ({}))) as { subject?: string; metadata?: unknown };

    const { data: existing, error: existingErr } = await admin
      .from("conversations")
      .select("id")
      .eq("application_id", application_id)
      .eq("customer_identifier", identifier)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;

    let conversationId = existing?.id as string | undefined;

    if (!conversationId) {
      const { data: created, error: createErr } = await admin
        .from("conversations")
        .insert({
          application_id,
          customer_identifier: identifier,
          subject: body.subject ?? null,
          metadata: body.metadata ?? null,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      conversationId = created.id;

      const { error: partErr } = await admin.from("conversation_participants").insert({
        conversation_id: conversationId,
        application_id,
        identifier,
        role: "customer",
      });
      if (partErr) throw partErr;
    }

    const { error: ensurePartErr } = await admin.from("conversation_participants").upsert(
      {
        conversation_id: conversationId,
        application_id,
        identifier,
        role: "customer",
      },
      { onConflict: "conversation_id,identifier" }
    );
    if (ensurePartErr) throw ensurePartErr;

    return new Response(JSON.stringify({ conversation_id: conversationId }), {
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
