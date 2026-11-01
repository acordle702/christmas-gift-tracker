const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Conversation = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

type ChatResponse =
  | { done: false; reply: string; conversation: Conversation }
  | {
      done: true;
      reply: string;
      person: string;
      relationship: string;
      sizes: string;
      budget: number;
      gift: string;
      store: string;
      price: number;
      status: "idea" | "ordered" | "delivered" | "wrapped";
      hiding_spot: string;
      link: string;
      conversation: Conversation;
    };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json() as { message?: string; conversation?: Conversation };
    const userMessage = body.message?.trim();
    if (!userMessage) {
      return new Response(JSON.stringify({ error: "A message is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conversation: Conversation = body.conversation ?? { messages: [] };
    conversation.messages.push({ role: "user", content: userMessage });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const result = localInterview(conversation);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a warm, friendly Christmas gift-list helper having a conversation with a busy parent. Your job is to gather enough information to add a gift to their list, by asking follow-up questions one at a time (interview-style).

The information you need (only some may be relevant):
- person: who the gift is for (REQUIRED)
- gift: what the gift is (REQUIRED)
- relationship: the person's relationship to the shopper (e.g. "Mom", "son")
- sizes: any clothing/shoe sizes for this person
- budget: how much they plan to spend on this person
- store: where the gift is from
- price: how much it cost
- status: one of "idea", "ordered", "delivered", "wrapped"
- hiding_spot: where the gift is hidden at home
- link: a product URL if mentioned

Rules:
1. If the user's message has enough to identify BOTH a person AND a gift, you are ready to save. Return done: true with all fields filled from the conversation so far.
2. If information is missing, ask ONE follow-up question in a friendly, conversational way. Return done: false with the question as reply.
3. Don't ask about fields the user clearly doesn't care about. If they mention a gift idea without a price, that's fine — price can be 0. Only ask about price if they said they bought it but didn't say how much. Only ask about hiding_spot if they mentioned hiding it but didn't say where.
4. ALWAYS ask for a product link if one hasn't been mentioned yet — say something like "Do you have a link for it?" — but only after you know the person and gift. If they don't have one, save with an empty link.
5. Keep replies under 25 words, warm and casual.
6. Determine status from context: "ordered"/"bought" = ordered, "arrived"/"delivered"/"shipped" = delivered, "wrapped" = wrapped, otherwise idea.
7. Extract any URL as link. Set store based on the URL domain (amazon -> Amazon, target.com -> Target, other -> Other) or from context.

Return ONLY valid JSON with this shape:
{"done": false, "reply": "follow-up question", "conversation": {"messages": [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}}
or
{"done": true, "reply": "confirmation message", "person": "...", "relationship": "", "sizes": "", "budget": 0, "gift": "...", "store": "Amazon", "price": 0, "status": "idea", "hiding_spot": "", "link": "", "conversation": {"messages": [...]}}

The conversation array must include ALL messages so far including the user's latest and your new assistant reply.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 800,
        system: systemPrompt,
        messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const result = localInterview(conversation);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json() as { content?: Array<{ text?: string }> };
    const text = result.content?.[0]?.text;
    if (!text) throw new Error("Empty chat response");
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as ChatResponse;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "I couldn't sort that note yet. Try saying it another way." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function localInterview(conversation: Conversation): ChatResponse {
  const allUserText = conversation.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  const lower = allUserText.toLowerCase();
  const personMatch = allUserText.match(/(?:for|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const giftMatch = allUserText.match(/(?:wants?|gets?|gift(?:ed)?|bought|ordered|thinking(?:\s+of)?|considering)\s+(?:a|an|the)?\s*(.+?)(?:,|\s+size\b|\s+for\s+\$|\s+around\s+\$|\s+from\s+|\s+at\s+|$)/i);
  const urlMatch = allUserText.match(/https?:\/\/[^\s,]+/i);
  const priceMatch = allUserText.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  const hidingMatch = allUserText.match(/(?:hid|hide|hidden|put it|in)\s+(?:it\s+)?(?:in|at|under|behind)\s+([^,.]+)/i);
  const status = lower.includes("wrapped") ? "wrapped" : lower.includes("delivered") || lower.includes("arrived") ? "delivered" : lower.includes("ordered") || lower.includes("bought") ? "ordered" : "idea";

  const person = personMatch?.[1]?.trim();
  const gift = giftMatch?.[1]?.trim();

  const hasLink = !!urlMatch;
  const askedAboutLink = conversation.messages.some((m) => m.role === "assistant" && /link|url/i.test(m.content));

  const reply = () => {
    if (!person && !gift) return "Who is this gift for, and what are you thinking of getting them?";
    if (!person) return `A ${gift ?? "gift"} — nice! Who is it for?`;
    if (!gift) return `${person} sounds great. What are you thinking of getting them?`;
    if (!askedAboutLink) return `Do you have a link for the ${gift}? Paste it if you do, or say no.`;
    return `Got it — ${gift} for ${person}. Saved to your list!`;
  };

  const ready = person && gift && (askedAboutLink || hasLink);

  if (ready) {
    return {
      done: true,
      reply: reply(),
      person,
      relationship: "",
      sizes: "",
      budget: 0,
      gift,
      store: urlMatch?.[0] ? detectStore(urlMatch[0]) : "Amazon",
      price: priceMatch ? Number(priceMatch[1]) : 0,
      status,
      hiding_spot: hidingMatch?.[1]?.trim() ?? "",
      link: urlMatch?.[0] ?? "",
      conversation,
    };
  }

  conversation.messages.push({ role: "assistant", content: reply() });
  return { done: false, reply: reply(), conversation };
}

function detectStore(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("target.com")) return "Target";
    if (host.includes("amazon.")) return "Amazon";
    return "Other";
  } catch {
    return "Amazon";
  }
}
