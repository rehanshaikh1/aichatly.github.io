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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacter(id);

  const title = character?.name ? `${character.name} | AI Chat` : "AI Chat";
  const description =
    character?.description_en ||
    character?.description_tr ||
    "Chat with this AI character.";

  const pageUrl = `https://aichatly-github-io.vercel.app/chat/${id}`;
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
          width: 1200,
          height: 630,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image], // ✅ FIXED
    },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const character = await getCharacter(id);

  return <ChatPageClient initialCharacter={character} />;
}