"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { language } = useLanguage();
  const isMobile = useIsMobile();
  const isTabletOrMobile = useIsTabletOrMobile();

  // FIX: Move dynamic imports inside useMemo to bypass the SSR build error
  const ChatLeftPanel = useMemo(() => dynamic(
    () => import("@/components/chat/ChatLeftPanel").then((m) => m.ChatLeftPanel),
    { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-[#999]">Loading...</div> }
  ), []);

  const ChatRightPanel = useMemo(() => dynamic(
    () => import("@/components/chat/ChatRightPanel").then((m) => m.ChatRightPanel),
    { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-[#999]">Loading...</div> }
  ), []);

  const ChatMiddlePanel = useMemo(() => dynamic(
    () => import("@/components/chat/ChatMiddlePanel").then((m) => m.ChatMiddlePanel),
    { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-[#999]">Loading chat...</div> }
  ), []);

  const characterId = params?.id as string;
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

  useEffect(() => {
    setIsGuest(!user);
    fetchCharacter();
    if (user) { fetchConversations(); } else { loadGuestConversations(); }
  }, [user, characterId, requestedConversationId]);

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
      } catch (error) { console.error("Error verifying share:", error); }
      finally {
        url.searchParams.delete("share_id");
        window.history.replaceState({}, "", url.toString());
      }
    };
    void verifyShareClick();
  }, []);

  useEffect(() => {
    if (!rewardedAdUnitPath) return;
    preloadRewardedAdSdk().catch(() => {});
  }, [rewardedAdUnitPath]);

  const fetchCharacter = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("characters").select("*").eq("id", characterId).maybeSingle();
      if (data) {
        setCharacter(data);
        sessionStorage.setItem(`${CHAT_CHARACTER_CACHE_PREFIX}${characterId}`, JSON.stringify(data));
      } else { router.push("/"); }
    } catch (e) { router.push("/"); }
    finally { setLoading(false); }
  };

  const loadGuestConversations = () => {
    try {
      const stored = localStorage.getItem(GUEST_CONVERSATIONS_KEY);
      const guestConvs = stored ? JSON.parse(stored) : [];
      setConversations(guestConvs);
      const match = guestConvs.find((c: any) => c.character_id === characterId);
      if (match) { setCurrentConversationId(match.id); } 
      else { createGuestConversation(); }
    } catch (e) { createGuestConversation(); }
  };

  const createGuestConversation = () => {
    const id = `guest_conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newConv = { id, character_id: characterId, last_message_at: new Date().toISOString(), message_count: 0 };
    try {
      const stored = localStorage.getItem(GUEST_CONVERSATIONS_KEY);
      const guestConvs = stored ? JSON.parse(stored) : [];
      guestConvs.push(newConv);
      localStorage.setItem(GUEST_CONVERSATIONS_KEY, JSON.stringify(guestConvs));
      setCurrentConversationId(id);
      loadGuestConversations();
    } catch (e) { console.error(e); }
  };

  const loadGuestMessages = async () => {
    try {
      const stored = localStorage.getItem(GUEST_MESSAGES_KEY);
      const all = stored ? JSON.parse(stored) : [];
      const filtered = all.filter((m: Message) => m.conversation_id === currentConversationId);
      setMessages(filtered);
      if (filtered.length === 0 && character) { await sendWelcomeMessage(); } else { setWelcomeMessageSent(true); }
    } catch (e) { setMessages([]); if (character) await sendWelcomeMessage(); }
  };

  const saveGuestMessage = (message: Message) => {
    try {
      const stored = localStorage.getItem(GUEST_MESSAGES_KEY);
      const all = stored ? JSON.parse(stored) : [];
      all.push(message);
      localStorage.setItem(GUEST_MESSAGES_KEY, JSON.stringify(all));
    } catch (e) { console.error(e); }
  };

  const fetchConversations = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from("conversations").select("*").eq("user_id", user.id).order("last_message_at", { ascending: false });
      if (data) {
        const withChars = await Promise.all(data.map(async (conv) => {
          const { data: c } = await supabase.from("characters").select("*").eq("id", conv.character_id).maybeSingle();
          return { ...conv, character: c || undefined };
        }));
        setConversations(withChars as Conversation[]);
        const match = data.find((c) => c.character_id === characterId);
        if (match) { setCurrentConversationId(match.id); } else { createNewConversation(); }
      } else { createNewConversation(); }
    } catch (e) { console.error(e); }
  };

  const createNewConversation = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from("conversations").insert({ user_id: user.id, character_id: characterId, message_count: 0 }).select().maybeSingle();
      if (data) { setCurrentConversationId(data.id); fetchConversations(); }
    } catch (e) { console.error(e); }
  };

  const generateWelcomeMessage = (): string => {
    if (!character) return "";
    const name = character.name || "";
    const personality = language === "tr" ? (character.description_tr || character.description_en || "") : (character.description_en || character.description_tr || "");
    const instr = character.character_instructions || "";
    const prof = language === "tr" ? (character.occupation_tr || character.occupation_en || "") : (character.occupation_en || character.occupation_tr || "");
    return `You are ${name}.\nPersonality: ${personality}\nDescription: ${instr}\nProfession: ${prof}`;
  };

  const sendWelcomeMessage = async () => {
    if (!currentConversationId || !character || welcomeMessageSent) return;
    const content = generateWelcomeMessage();
    try {
      if (user) {
        const { data } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "character", content }).select().maybeSingle();
        if (data) { setMessages((prev) => [...prev, data]); setWelcomeMessageSent(true); }
      } else {
        const msg: Message = { id: `g_w_${Date.now()}`, conversation_id: currentConversationId, sender_type: "character", content, created_at: new Date().toISOString() };
        saveGuestMessage(msg);
        setMessages((prev) => [...prev, msg]);
        setWelcomeMessageSent(true);
      }
    } catch (e) { console.error(e); }
  };

  const fetchMessages = async () => {
    if (!currentConversationId) return;
    try {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", currentConversationId).order("created_at", { ascending: true });
      if (data) {
        setMessages(data);
        if (data.length === 0 && character) { await sendWelcomeMessage(); } else { setWelcomeMessageSent(true); }
      }
    } catch (e) { console.error(e); }
  };

  const sendMessage = async (content: string) => {
    if (!currentConversationId) return;
    if (user) {
      const history = messages.slice(-10).map((m) => ({ role: m.sender_type === "user" ? ("user" as const) : ("assistant" as const), content: m.content }));
      history.push({ role: "user", content });
      try {
        const res = await fetch("/api/chat/completion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, characterId, userId: user.id }) });
        if (!res.ok) {
          const body = await res.json();
          if (body?.error?.toLowerCase().includes("limit")) { await loadRewardRemainingCounts(); setShowLimitPopup(true); return; }
          throw new Error("Failed");
        }
        const data = await res.json();
        const { data: uMsg } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "user", content }).select().maybeSingle();
        if (uMsg) setMessages(p => [...p, uMsg]);
        const { data: aMsg } = await supabase.from("messages").insert({ conversation_id: currentConversationId, sender_type: "character", content: data.content }).select().maybeSingle();
        if (aMsg) setMessages(p => [...p, aMsg]);
        setMessageCount(prev => prev + 1);
      } catch (e) { toast.error("Error sending message."); }
    } else {
      const gMsg: Message = { id: `g_u_${Date.now()}`, conversation_id: currentConversationId, sender_type: "user", content, created_at: new Date().toISOString() };
      saveGuestMessage(gMsg); setMessages(p => [...p, gMsg]);
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
      const ad = await showRewardedAd(rewardedAdUnitPath);
      if (ad.success) {
        const res = await fetch("/api/rewards/video-watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", userId: user.id }) });
        if (res.ok) { toast.success("Reward claimed!"); setShowLimitPopup(false); }
      }
    } catch (e) { toast.error("Ad failed"); }
    finally { setClaimingVideoReward(false); await loadRewardRemainingCounts(); }
  };

  const loadMessageCount = async () => {
    if (!currentConversationId || !user) return;
    try {
      const { count } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("conversation_id", currentConversationId).eq("sender_type", "user");
      setMessageCount(count || 0);
    } catch (e) { console.error(e); }
  };

  const loadGuestMessageCount = () => {
    if (!currentConversationId) return;
    try {
      const stored = localStorage.getItem(GUEST_MESSAGES_KEY);
      const guestMsgs = stored ? JSON.parse(stored) : [];
      const count = guestMsgs.filter((m: Message) => m.conversation_id === currentConversationId && m.sender_type === "user").length;
      setMessageCount(count);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (currentConversationId) {
      if (user) { fetchMessages(); loadMessageCount(); } else { loadGuestMessages(); loadGuestMessageCount(); }
    }
  }, [currentConversationId, user]);

  if (!character) return <div className="h-screen w-full bg-[#0f0f0f] flex items-center justify-center text-white text-lg">Loading...</div>;

  return (
    <>
      <div className="h-screen w-full bg-[#0f0f0f] flex overflow-hidden">
        {!isTabletOrMobile && (
          <div className="w-[20%] min-w-[280px] border-r border-white/[0.08] bg-[#111111]">
            <ChatLeftPanel conversations={conversations} currentConversationId={currentConversationId} onConversationSelect={(id: string) => router.replace(`/chat/${id}`)} isGuest={isGuest} />
          </div>
        )}
        <div className="flex-1 flex flex-col bg-[#121212]">
          <ChatMiddlePanel character={character} messages={messages} onSendMessage={sendMessage} onToggleLeftPanel={() => setShowLeftPanel(!showLeftPanel)} onToggleRightPanel={() => setShowRightPanel(!showRightPanel)} showMobileControls={isTabletOrMobile} isGuest={isGuest} conversationId={currentConversationId} />
        </div>
        {!isTabletOrMobile && (
          <div className="w-[22%] min-w-[300px] border-l border-white/[0.08] bg-[#111111]">
            <ChatRightPanel character={character} messageCount={messageCount} />
          </div>
        )}
      </div>

      {isTabletOrMobile && showLeftPanel && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowLeftPanel(false)}>
          <div className="absolute left-0 top-0 h-full w-[80%] max-w-[320px] bg-[#111111] border-r border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
            <ChatLeftPanel conversations={conversations} currentConversationId={currentConversationId} onConversationSelect={(id: string) => { router.replace(`/chat/${id}`); setShowLeftPanel(false); }} isGuest={isGuest} onClose={() => setShowLeftPanel(false)} />
          </div>
        </div>
      )}

      {isTabletOrMobile && showRightPanel && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowRightPanel(false)}>
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-[360px] bg-[#111111] border-l border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
            <ChatRightPanel character={character} messageCount={messageCount} onClose={() => setShowRightPanel(false)} />
          </div>
        </div>
      )}

      <Dialog open={showLimitPopup} onOpenChange={setShowLimitPopup}>
        <DialogContent className="bg-[#1a1a1a] border-white/[0.08] text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Limit Reached</DialogTitle>
            <DialogDescription className="text-gray-400">Watch a video to earn +15 messages!</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 mt-4">
            <Button onClick={handleWatchVideoReward} disabled={claimingVideoReward} className="flex-1 bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white">
              {claimingVideoReward ? "Loading..." : "Watch Video"}
            </Button>
            <Button onClick={() => setShowLimitPopup(false)} variant="outline" className="flex-1 border-white/[0.08] text-white">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}