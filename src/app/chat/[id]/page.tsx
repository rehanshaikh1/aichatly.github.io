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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const character = await getCharacter(id);

  const title = character?.name ? `${character.name} | AI Chat` : "AI Chat";

  const description =
    character?.description_en ||
    character?.description_tr ||
    "Chat with this AI character.";

  // Force a public static image for WhatsApp preview
  const image = "https://aichatly-github-io.vercel.app/preview.jpg";

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

export default async function Page() {
  return <ChatPageClient />;
}