import type { Metadata } from "next";
import { supabase } from "@/integrations/supabase/client";
import ChatPageClient from "./ChatPageClient";

type Props = {
  params: Promise<{ id: string }>;
};

async function getCharacter(id: string) {
  const { data } = await supabase
    .from("characters")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return data;
}

function getDirectImageUrl(imageUrl?: string | null) {
  const fallback = "https://aichatly-github-io.vercel.app/default.png";

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacter(id);

  const title = character?.name ? `${character.name} | AI Chat` : "AI Chat";
  const description =
    character?.description_en ||
    character?.description_tr ||
    "Chat with this AI character.";

  const pageUrl = `https://aichatly-github-io.vercel.app/chat/${id}`;

  // ✅ STATIC TEST IMAGE
  const image = "https://aichatly-github-io.vercel.app/default.png";

  return {
    metadataBase: new URL("https://aichatly-github-io.vercel.app"),
    title,
    description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "AI Chatly",
      images: [
        {
          url: image,
          secureUrl: image,
          width: 1200,
          height: 630,
          alt: title,
          type: "image/png",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function Page() {
  return <ChatPageClient />;
}