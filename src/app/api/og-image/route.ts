import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const fallbackUrl = "https://aichatly-github-io.vercel.app/og-default.jpg";
  const src = request.nextUrl.searchParams.get("src") || fallbackUrl;

  let finalUrl = src;

  try {
    // basic safety: only allow http/https
    const parsed = new URL(src);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      finalUrl = fallbackUrl;
    }
  } catch {
    finalUrl = fallbackUrl;
  }

  try {
    const response = await fetch(finalUrl, {
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
  } catch (error) {
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