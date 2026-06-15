import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SubmitBody = {
  formId: string;
  answers: Record<string, unknown>;
  meta: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    questionsVisited: string[];
    hiddenFields: Record<string, unknown>;
    score?: number;
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('Server misconfigured', { status: 500, headers: corsHeaders });
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }

  if (!body.formId || !body.answers || !body.meta) {
    return new Response('Missing fields', { status: 400, headers: corsHeaders });
  }

  const honeypot = body.meta.hiddenFields?._hp;
  if (honeypot) {
    return new Response(JSON.stringify({ id: 'ignored' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('id, name, slug, status, published_schema, deleted_at')
    .eq('id', body.formId)
    .maybeSingle();

  if (formError || !form || form.deleted_at || form.status !== 'published') {
    return new Response('Form not available', { status: 404, headers: corsHeaders });
  }

  const submissionId = `s_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const { error: insertError } = await supabase.from('submissions').insert({
    id: submissionId,
    form_id: body.formId,
    answers: body.answers,
    meta: body.meta,
    received_at: new Date().toISOString(),
  });

  if (insertError) {
    return new Response(insertError.message, { status: 500, headers: corsHeaders });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const notifyTo = Deno.env.get('PSW_NOTIFY_EMAIL') ?? 'hello@palmstreetweb.com';
  if (resendKey) {
    const origin =
      Deno.env.get('PUBLIC_FORM_BASE')?.replace(/\/$/, '') ??
      'https://slateforms.vercel.app';
    const responsesUrl = `${origin}/#/forms/${body.formId}/submissions`;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Slate <notifications@palmstreetweb.com>',
          to: [notifyTo],
          subject: `New response: ${form.name}`,
          html: `<p>A new response arrived for <strong>${form.name}</strong>.</p><p><a href="${responsesUrl}">View in Slate</a></p>`,
        }),
      });
    } catch {
      // Notification failure must not fail the submission.
    }
  }

  return new Response(JSON.stringify({ id: submissionId }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
