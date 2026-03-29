import { Metadata } from "next";
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

function getOgImageUrl(imageUrl?: string | null) {
  if (!imageUrl) {
    return "https://aichatly-github-io.vercel.app/preview.jpg";
  }

  // If stored URL is a Next.js optimizer URL, extract the real source image
  if (imageUrl.includes("/_next/image?url=")) {
    try {
      const parsed = new URL(imageUrl);
      const realUrl = parsed.searchParams.get("url");
      if (realUrl) {
        return decodeURIComponent(realUrl);
      }
    } catch {
      return "https://aichatly-github-io.vercel.app/preview.jpg";
    }
  }

  // Force https if possible
  if (imageUrl.startsWith("http://")) {
    return imageUrl.replace("http://", "https://");
  }

  return imageUrl;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacter(id);

  const title = character?.name ? `${character.name} | AI Chat` : "AI Chat";
  const description =
    character?.description_en ||
    character?.description_tr ||
    "Chat with this AI character.";

  const image = getOgImageUrl(character?.image_url);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://aichatly-github-io.vercel.app/chat/${id}`,
      siteName: "AI Chatly",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
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