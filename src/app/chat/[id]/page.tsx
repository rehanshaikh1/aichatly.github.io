import React from "react";
import { Metadata, ResolvingMetadata } from "next";
import { supabase } from "@/integrations/supabase/client";

/** * 1. SERVER-SIDE: DYNAMIC METADATA
 * This section runs on the server so WhatsApp/Meta can see the image.
 */
export async function generateMetadata(
  { params }: { params: { id: string } },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const id = params.id;

  const { data: character } = await supabase
    .from("characters")
    .select("name, description_en, image_url")
    .eq("id", id)
    .maybeSingle();

  const title = character ? `Chat with ${character.name}` : "AI Chat | AziBiz";
  const description = character?.description_en || "Chat with your favorite AI characters on AziBiz.";
  const fallbackImage = "https://aichatly-github-io.vercel.app/default.png";
  const image = character?.image_url || fallbackImage;

  return {
    title: title,
    description: description,
    openGraph: {
      title: title,
      description: description,
      url: `https://aichatly-github-io.vercel.app/chat/${id}`,
      siteName: "AziBiz AI",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: character?.name || "AI Character",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: title,
      description: description,
      images: [image],
    },
  };
}

/**
 * 2. SERVER COMPONENT: ENTRY POINT
 */
export default function Page({ params }: { params: { id: string } }) {
  return <ChatClientFullLogic characterId={params.id} />;
}

/**
 * 3. CLIENT-SIDE: THE FULL 1000-LINE LOGIC
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile, useIsTabletOrMobile } from "@/hooks/use-mobile";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { preloadRewardedAdSdk, showRewardedAd } from "@/lib/rewarded-ad";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ChatLeftPanel = dynamic(
  () => import("@/components/chat/ChatLeftPanel").then((m) => m.ChatLeftPanel),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-[#999]">Loading...</div> }
);

const ChatRightPanel = dynamic(
  () => import("@/components/chat/ChatRightPanel").then((m) => m.ChatRightPanel),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-[#999]">Loading...</div> }
);

const ChatMiddlePanel = dynamic(
  () => import("@/components/chat/ChatMiddlePanel").then((m) => m.ChatMiddlePanel),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-[#999]">Loading chat...</div> }
);

interface Character {
  id: string;
  name: string;
  occupation_en: string | null;
  occupation_tr: string | null;
  description_en: string | null;
  description_tr: string | null;
  character_instructions?: string;
  character_type: "ai" | "real";
  gender: "male" | "female" | null;
  image_url: string;
  is_anime: boolean;
  creator_id: string;
  likes_count: number;
  favorites_count: number;
  chat_count: number;
  age?: string | null;
  country?: string | null;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_type: "user" | "character";
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  character_id: string;
  last_message_at: string;
  message_count?: number;
  character?: Character;
}

const GUEST_MESSAGES_KEY = "guest_messages";
const GUEST_CONVERSATIONS_KEY = "guest_conversations";
const CHAT_CHARACTER_CACHE_PREFIX = "chat_character_cache_";

function ChatClientFullLogic({ characterId }: { characterId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { language } = useLanguage();
  const isMobile = useIsMobile();
  const isTabletOrMobile = useIsTabletOrMobile();

  const requestedConversationId = searchParams.get("conversationId");

  const [character, setCharacter] = useState<Character | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = sessionStorage.getItem(`${CHAT_CHARACTER_CACHE_PREFIX}${characterId}`);
      return cached ? (JSON.parse(cached) as Character) : null;
    } catch { return null; }
  });
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [welcomeMessageSent, setWelcomeMessageSent] = useState(false);
  const [showLimitPopup, setShowLimitPopup] = useState(false);
  const [videoRemaining, setVideoRemaining] = useState(0);
  const [shareRemaining, setShareRemaining] = useState(0);
  const [claimingVideoReward, setClaimingVideoReward] = useState(false);
  const rewardedAdUnitPath = process.env.NEXT_PUBLIC_GAM_REWARDED_AD_UNIT_PATH || "";

  // 1. Initial Load
  useEffect(() => {
    setIsGuest(!user);
    fetchCharacter();
    if (user) { fetchConversations(); } else { loadGuestConversations(); }
  }, [user, characterId, requestedConversationId]);

  // 2. Share Verification
  useEffect(() => {
    const verifyShareClick = async () => {
      const url = new URL(window.location.href);
      const shareId = url.searchParams.get("share_id") || url.searchParams.get("share_ref");
      if (!shareId) return;
      const consumeKey = `share_ref_consumed_${shareId}`;
      if (sessionStorage.getItem(consumeKey)) return;
      try {
        const res = await fetch("/api/rewards/character-share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify_click", shareId }),
        });
        const data = await res.json();
        if (data?.success) { sessionStorage.setItem(consumeKey, "1"); }
      } catch (error) { console.error("Error verifying share click:", error); }
      finally {
        url.searchParams.delete("share_id");
        url.searchParams.delete("share_ref");
        url.searchParams.delete("share_platform");
        window.history.replaceState({}, "", url.toString());
      }
    };
    void verifyShareClick();
  }, []);

  // 3. Ad Preload
  useEffect(() => {
    if (!rewardedAdUnitPath) return;
    preloadRewardedAdSdk().catch(() => {});
  }, [rewardedAdUnitPath]);

  // 4. Character Fetching
  const fetchCharacter = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("characters").select("*").eq("id", characterId).maybeSingle();
      if (data) {
        setCharacter(data);
        sessionStorage.setItem(`${CHAT_CHARACTER_CACHE_PREFIX}${characterId}`, JSON.stringify(data));
      } else { router.push("/"); }
    } catch (error) { router.push("/"); }
    finally { setLoading(false); }
  };

  // 5. Guest Logic
  const loadGuestConversations = () => {
    try {
      const stored = localStorage.getItem(GUEST_CONVERSATIONS_KEY);
      const guestConvs = stored ? JSON.parse(stored) : [];
      setConversations(guestConvs);
      const existingConv = guestConvs.find((c: any) => c.character_id === characterId);
      if (existingConv) { setCurrentConversationId(existingConv.id); } 
      else { createGuestConversation(); }
    } catch (error) { createGuestConversation(); }
  };

  const createGuestConversation = () => {
    const newConvId = `guest_conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newConv = { id: newConvId, character_id: characterId, last_message_at: new Date().toISOString(), message_count: 0 };
    try {
      const stored = localStorage.getItem(GUEST_CONVERSATIONS_KEY);
      const guestConvs = stored ? JSON.parse(stored) : [];
      guestConvs.push(newConv);
      localStorage.setItem(GUEST_CONVERSATIONS_KEY, JSON.stringify(guestConvs));
      setCurrentConversationId(newConvId);
      setConversations(guestConvs);
    } catch (e) { console.error(e); }
  };

  const loadGuestMessages = async () => {
    try {
      const stored = localStorage.getItem(GUEST_MESSAGES_KEY);
      const allMessages = stored ? JSON.parse(stored) : [];
      const convMessages = allMessages.filter((m: Message) => m.conversation_id === currentConversationId);
      setMessages(convMessages);
      if (convMessages.length === 0 && character) { await sendWelcomeMessage(); }
      else { setWelcomeMessageSent(true); }
    } catch (e) { setMessages([]); }
  };

  const saveGuestMessage = (message: Message) => {
    try {
      const stored = localStorage.getItem(GUEST_MESSAGES_KEY);
      const allMessages = stored ? JSON.parse(stored) : [];
      allMessages.push(message);
      localStorage.setItem(GUEST_MESSAGES_KEY, JSON.stringify(allMessages));
    } catch (e) { console.error(e); }
  };

  // 6. User Logic
  const fetchConversations = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from("conversations").select("*").eq("user_id", user.id).order("last_message_at", { ascending: false });
      if (data) {
        const conversationsWithCharacters = await Promise.all(
          data.map(async (conv) => {
            const { data: charData } = await supabase.from("characters").select("*").eq("id", conv.character_id).maybeSingle();
            return { ...conv, character: charData || undefined };
          })
        );
        setConversations(conversationsWithCharacters as Conversation[]);
        const existingConv = data.find((c) => c.character_id === characterId);
        if (existingConv) { setCurrentConversationId(existingConv.id); } 
        else { createNewConversation(); }
      }
    } catch (e) { console.error(e); }
  };

  const createNewConversation = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, character_id: characterId, message_count: 0 }).select().maybeSingle();
      if (data && !error) { setCurrentConversationId(data.id); fetchConversations(); }
    } catch (e) { console.error(e); }
  };

  const fetchMessages = async () => {
    if (!currentConversationId) return;
    try {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", currentConversationId).order("created_at", { ascending: true });
      if (data) {
        setMessages(data);
        if (data.length === 0 && character) { await sendWelcomeMessage(); }
        else { setWelcomeMessageSent(true); }
      }
    } catch (e) { console.error(e); }
  };

  // 7. Messaging Logic
  const sendWelcomeMessage = async () => {
    if (!currentConversationId || !character || welcomeMessageSent) return;
    const welcomeContent = `You are ${character.name}.\nPersonality: ${character.description_en}`;
    try {
      if (user) {
        const { data: newMessage } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "character", content: welcomeContent }).select().maybeSingle();
        if (newMessage) { setMessages((prev) => [...prev, newMessage]); setWelcomeMessageSent(true); }
      } else {
        const welcomeMessage: Message = { id: `g_welcome_${Date.now()}`, conversation_id: currentConversationId, sender_type: "character", content: welcomeContent, created_at: new Date().toISOString() };
        saveGuestMessage(welcomeMessage);
        setMessages((prev) => [...prev, welcomeMessage]);
        setWelcomeMessageSent(true);
      }
    } catch (e) { console.error(e); }
  };

  const sendMessage = async (content: string) => {
    if (!currentConversationId) return;
    if (user) {
      const recentMessages = messages.slice(-10).map((msg) => ({
        role: msg.sender_type === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      }));
      recentMessages.push({ role: "user" as const, content });
      try {
        const response = await fetch("/api/chat/completion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: recentMessages, characterId, userId: user.id }),
        });
        if (!response.ok) {
          const errorBody = await response.json();
          if (errorBody?.error?.toLowerCase().includes("limit")) {
            await loadRewardRemainingCounts();
            setShowLimitPopup(true);
            return;
          }
          throw new Error("Chat failed");
        }
        const data = await response.json();
        const { data: savedUser } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "user", content }).select().maybeSingle();
        if (savedUser) setMessages((prev) => [...prev, savedUser]);
        const { data: aiMsg } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "character", content: data.content }).select().maybeSingle();
        if (aiMsg) setMessages((prev) => [...prev, aiMsg]);
        setMessageCount(prev => prev + 1);
      } catch (e) { toast.error("Failed to send message."); }
    } else {
      const guestUserMsg: Message = { id: `gu_${Date.now()}`, conversation_id: currentConversationId, sender_type: "user", content, created_at: new Date().toISOString() };
      saveGuestMessage(guestUserMsg);
      setMessages((prev) => [...prev, guestUserMsg]);
    }
  };

  const loadRewardRemainingCounts = async () => {
    if (!user) return;
    try {
      const [vRes, sRes] = await Promise.all([
        fetch("/api/rewards/video-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", userId: user.id }) }),
        fetch("/api/rewards/character-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", userId: user.id }) }),
      ]);
      const vData = await vRes.json();
      const sData = await sRes.json();
      setVideoRemaining(Math.max(0, Number(vData?.remainingCount ?? 0)));
      setShareRemaining(Math.max(0, Number(sData?.remainingCount ?? 0)));
    } catch (e) { console.error(e); }
  };

  const handleWatchVideoReward = async () => {
    if (!user || !rewardedAdUnitPath) return;
    setClaimingVideoReward(true);
    try {
      const adResult = await showRewardedAd(rewardedAdUnitPath);
      if (adResult.success) {
        const res = await fetch("/api/rewards/video-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", userId: user.id }) });
        if (res.ok) { toast.success("Reward claimed!"); setShowLimitPopup(false); }
      }
    } catch (e) { toast.error("Ad failed"); }
    finally { setClaimingVideoReward(false); await loadRewardRemainingCounts(); }
  };

  // 8. View Handlers
  useEffect(() => {
    if (currentConversationId) {
      if (user) { fetchMessages(); } else { loadGuestMessages(); }
    }
  }, [currentConversationId]);

  if (!character) return <div className="h-screen w-full bg-[#0f0f0f] flex items-center justify-center text-white">Loading...</div>;

  return (
    <>
      <div className="h-screen w-full bg-[#0f0f0f] flex overflow-hidden">
        {!isTabletOrMobile && (
          <div className="w-[20%] min-w-[280px] bg-[#111111] border-r border-white/10">
            <ChatLeftPanel conversations={conversations} currentConversationId={currentConversationId} onConversationSelect={(id) => router.replace(`/chat/${id}`)} isGuest={isGuest} />
          </div>
        )}
        <div className="flex-1 flex flex-col bg-[#121212]">
          <ChatMiddlePanel character={character} messages={messages} onSendMessage={sendMessage} onToggleLeftPanel={() => setShowLeftPanel(!showLeftPanel)} onToggleRightPanel={() => setShowRightPanel(!showRightPanel)} showMobileControls={isTabletOrMobile} isGuest={isGuest} conversationId={currentConversationId} />
        </div>
        {!isTabletOrMobile && (
          <div className="w-[22%] min-w-[300px] bg-[#111111] border-l border-white/10">
            <ChatRightPanel character={character} messageCount={messageCount} />
          </div>
        )}
      </div>

      {/* MOBILE OVERLAYS */}
      {isTabletOrMobile && showLeftPanel && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowLeftPanel(false)}>
          <div className="absolute left-0 h-full w-[80%] bg-[#111111]" onClick={(e) => e.stopPropagation()}>
            <ChatLeftPanel conversations={conversations} currentConversationId={currentConversationId} onConversationSelect={(id) => { router.replace(`/chat/${id}`); setShowLeftPanel(false); }} isGuest={isGuest} onClose={() => setShowLeftPanel(false)} />
          </div>
        </div>
      )}

      {isTabletOrMobile && showRightPanel && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowRightPanel(false)}>
          <div className="absolute right-0 h-full w-[85%] bg-[#111111]" onClick={(e) => e.stopPropagation()}>
            <ChatRightPanel character={character} messageCount={messageCount} onClose={() => setShowRightPanel(false)} />
          </div>
        </div>
      )}

      {/* REWARD DIALOG */}
      <Dialog open={showLimitPopup} onOpenChange={setShowLimitPopup}>
        <DialogContent className="bg-[#1a1a1a] text-white border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Limit Reached</DialogTitle>
            <DialogDescription className="text-gray-400">Watch a video or share to keep chatting!</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 mt-4">
            <Button onClick={handleWatchVideoReward} disabled={claimingVideoReward} className="flex-1 bg-purple-600">Watch Video</Button>
            <Button onClick={() => setShowRightPanel(true)} variant="outline" className="flex-1">Share</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}