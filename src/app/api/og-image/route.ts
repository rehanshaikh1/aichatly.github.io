import { supabase } from "@/integrations/supabase/client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getDirectImageUrl(imageUrl?: string | null) {
  const fallback = "https://aichatly-github-io.vercel.app/og-default.jpg";

  if (!imageUrl) return fallback;

  try {
    if (imageUrl.includes("/_next/image?url=")) {
      const parsed = new URL(imageUrl);
      const original = parsed.searchParams.get("url");
      if (original) return decodeURIComponent(original);
    }

    if (imageUrl.startsWith("http://")) {
      return imageUrl.replace("http://", "https://");
    }

    return imageUrl;
  } catch {
    return fallback;
  }
}

async function getCharacterImage(id: string) {
  const { data } = await supabase
    .from("characters")
    .select("image_url")
    .eq("id", id)
    .maybeSingle();

  return getDirectImageUrl(data?.image_url);
}

export async function GET(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const fallbackUrl = "https://aichatly-github-io.vercel.app/og-default.jpg";

  try {
    const finalUrl = await getCharacterImage(id);

    const response = await fetch(finalUrl || fallbackUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    try {
      const fallbackResponse = await fetch(fallbackUrl, {
        cache: "no-store",
      });

      const fallbackType =
        fallbackResponse.headers.get("content-type") || "image/jpeg";
      const fallbackBuffer = await fallbackResponse.arrayBuffer();

      return new Response(fallbackBuffer, {
        status: 200,
        headers: {
          "Content-Type": fallbackType,
          "Content-Disposition": "inline",
          "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
      });
    } catch {
      return new Response("Failed to load image", { status: 500 });
    }
  }
}