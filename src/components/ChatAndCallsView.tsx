import React, { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Camera,
  Check,
  CheckCheck,
  Edit3,
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Reply,
  Search,
  Send,
  Square,
  Trash2,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ActiveCallState } from '../hooks/useRealtime';
import { apiFetch } from '../lib/api';
import type { ChatMessage, Conversation, User } from '../types';

interface Props {
  user: User;
  onlineUserIds: number[];
  initialConversationId?: number | null;
  incomingMessage: ChatMessage | null;
  editedMessage: ChatMessage | null;
  deletedMessage: { id: number; conversation_id: number } | null;
  readPayload: { conversationId: number; readerId: number } | null;
  typingPayload: { conversationId: number; userId: number; isTyping: boolean } | null;
  sendWs: (event: string, payload: any) => void;
  onStartCall: (peerId: number, peerName: string, callType: 'audio' | 'video', conversationId?: number) => void;
  onRequireServicePass?: () => void;
}

export const ChatAndCallsView: React.FC<Props> = ({
  user,
  onlineUserIds,
  initialConversationId,
  incomingMessage,
  editedMessage,
  deletedMessage,
  readPayload,
  typingPayload,
  sendWs,
  onStartCall,
  onRequireServicePass,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(initialConversationId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [chatError, setChatError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    const res = await apiFetch<{ conversations: Conversation[] }>('/api/conversations');
    setConversations(res.conversations || []);
    if (!activeConvId && res.conversations?.length) {
      setActiveConvId(initialConversationId || res.conversations[0].id);
    }
  };

  useEffect(() => {
    loadConversations();
    apiFetch<{ calls: any[] }>('/api/calls/history')
      .then((res) => setCallHistory(res.calls || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialConversationId) setActiveConvId(initialConversationId);
  }, [initialConversationId]);

  useEffect(() => {
    if (!activeConvId) return;
    apiFetch<{ messages: ChatMessage[] }>(`/api/conversations/${activeConvId}/messages`)
      .then((res) => {
        setMessages(res.messages || []);
        apiFetch(`/api/conversations/${activeConvId}/read`, { method: 'POST' }).catch(() => {});
      })
      .catch(() => {});
  }, [activeConvId]);

  useEffect(() => {
    if (!incomingMessage) return;
    if (incomingMessage.conversation_id === activeConvId) {
      setMessages((prev) => (prev.some((m) => m.id === incomingMessage.id) ? prev : [...prev, incomingMessage]));
      if (incomingMessage.sender_id !== user.id) {
        apiFetch(`/api/conversations/${activeConvId}/read`, { method: 'POST' }).catch(() => {});
      }
    }
    loadConversations();
  }, [incomingMessage]);

  useEffect(() => {
    if (!editedMessage) return;
    setMessages((prev) => prev.map((m) => (m.id === editedMessage.id ? editedMessage : m)));
  }, [editedMessage]);

  useEffect(() => {
    if (!deletedMessage) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === deletedMessage.id ? { ...m, is_deleted: 1, content: '[Message deleted]', media_url: '' } : m
      )
    );
  }, [deletedMessage]);

  useEffect(() => {
    if (readPayload && readPayload.conversationId === activeConvId) {
      setMessages((prev) => prev.map((m) => (m.sender_id === user.id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)));
    }
  }, [readPayload, activeConvId, user.id]);

  useEffect(() => {
    if (typingPayload && typingPayload.conversationId === activeConvId && typingPayload.userId !== user.id) {
      setPeerTyping(typingPayload.isTyping);
    }
  }, [typingPayload, activeConvId, user.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const activeConv = conversations.find((c) => c.id === activeConvId) || null;
  const filteredConvs = conversations.filter((c) =>
    `${c.peerName} ${c.listing_title || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConvId || !text.trim()) return;
    setChatError('');

    try {
      if (editingMsg) {
        const res = await apiFetch<{ message: ChatMessage }>(`/api/messages/${editingMsg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content: text }),
        });
        setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
        setEditingMsg(null);
        setText('');
        return;
      }

      const res = await apiFetch<{ message: ChatMessage }>(`/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: text,
          messageType: 'text',
          replyToId: replyTo?.id || null,
        }),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setText('');
      setReplyTo(null);
      if (activeConv) {
        sendWs('chat:typing', { conversationId: activeConvId, targetUserId: activeConv.peerId, isTyping: false });
      }
    } catch (err: any) {
      setChatError(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
    }
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConvId) return;
    setChatError('');
    try {
      const fd = new FormData();
      fd.append('attachment', file);
      const res = await apiFetch<{ message: ChatMessage }>(`/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: fd,
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    } catch (err: any) {
      setChatError(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
    } finally {
      e.target.value = '';
    }
  };

  const toggleVoiceRecord = async () => {
    if (!activeConvId) return;
    setChatError('');
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      mr.ondataavailable = (evt) => {
        if (evt.data.size > 0) voiceChunksRef.current.push(evt.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
          const fd = new FormData();
          fd.append('attachment', new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }));
          fd.append('messageType', 'voice');
          fd.append('content', 'Voice message');
          const res = await apiFetch<{ message: ChatMessage }>(`/api/conversations/${activeConvId}/messages`, {
            method: 'POST',
            body: fd,
          });
          setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
        } catch (err: any) {
          setChatError(err.message);
          if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      // mic blocked
    }
  };

  const handleDeleteMsg = async (msgId: number) => {
    await apiFetch(`/api/messages/${msgId}`, { method: 'DELETE' });
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, is_deleted: 1, content: '[Message deleted]', media_url: '' } : m)));
  };

  const handleBlockPeer = async () => {
    if (!activeConv) return;
    await apiFetch(`/api/users/${activeConv.peerId}/block`, { method: 'POST', body: JSON.stringify({ reason: 'User blocked in chat' }) });
    loadConversations();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900 min-h-[620px]">
        {/* Left Conversation Sidebar */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-bold text-[#123B65] dark:text-white mb-2.5">Messages & Calls</h2>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filteredConvs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No conversations yet. Open any rental listing and click "Chat" to message an owner directly.
              </div>
            ) : (
              filteredConvs.map((c) => {
                const isOnline = onlineUserIds.includes(c.peerId) || c.peerOnline;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveConvId(c.id)}
                    className={`w-full text-left p-4 transition-colors ${
                      c.id === activeConvId ? 'bg-[#123B65]/5 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-white">
                        <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                        <span className="truncate">{c.peerName}</span>
                      </div>
                      {c.unread_count > 0 && (
                        <span className="rounded-full bg-[#F5A623] px-2 py-0.5 text-[10px] font-bold text-[#123B65]">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    {c.listing_title && (
                      <div className="mt-0.5 truncate text-[11px] font-medium text-[#123B65] dark:text-[#F5A623]">
                        {c.listing_title}
                      </div>
                    )}
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {c.last_message || 'Start chatting...'}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Call History Mini Drawer */}
          {callHistory.length > 0 && (
            <div className="border-t border-slate-200 p-3 dark:border-slate-800 max-h-40 overflow-y-auto">
              <div className="text-[11px] font-bold text-slate-500 mb-1.5">Recent Calls</div>
              {callHistory.slice(0, 5).map((call) => (
                <div key={call.id} className="flex items-center justify-between py-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="truncate">
                    {call.call_type === 'video' ? 'Video' : 'Audio'} · {call.caller_id === user.id ? call.callee_name : call.caller_name}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {call.status} {call.duration_seconds > 0 ? `(${call.duration_seconds}s)` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Chat Thread */}
        <div className="lg:col-span-8 flex flex-col h-[620px]">
          {activeConv ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                    {activeConv.peerName}
                    <span className="text-[11px] font-normal text-slate-500">
                      {onlineUserIds.includes(activeConv.peerId) ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  {peerTyping && <div className="text-[11px] text-emerald-600">Typing...</div>}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onStartCall(activeConv.peerId, activeConv.peerName, 'audio', activeConv.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700"
                  >
                    <Phone className="h-3.5 w-3.5 text-emerald-600" /> Call
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(activeConv.peerId, activeConv.peerName, 'video', activeConv.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700"
                  >
                    <Video className="h-3.5 w-3.5 text-[#F5A623]" /> Video
                  </button>
                  <button
                    type="button"
                    onClick={handleBlockPeer}
                    title="Block User"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-red-600 dark:border-slate-700"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[#F1F4F8]/60 dark:bg-slate-950/40">
                {messages.map((m) => {
                  const mine = m.sender_id === user.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                          mine
                            ? 'bg-[#123B65] text-white'
                            : 'bg-white text-slate-800 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100'
                        }`}
                      >
                        {m.reply_to_id && (
                          <div className="mb-1.5 border-l-2 border-[#F5A623] pl-2 text-[10px] opacity-80">
                            Replying to message #{m.reply_to_id}
                          </div>
                        )}
                        {m.message_type === 'image' && m.media_url && (
                          <img src={m.media_url} alt="attachment" className="mb-2 max-h-56 rounded-lg object-cover" />
                        )}
                        {m.message_type === 'video' && m.media_url && (
                          <video src={m.media_url} controls className="mb-2 max-h-56 rounded-lg" />
                        )}
                        {m.message_type === 'voice' && m.media_url && (
                          <audio src={m.media_url} controls className="mb-1.5 max-w-full" />
                        )}
                        {m.message_type === 'file' && m.media_url && (
                          <a href={m.media_url} download={m.file_name} className="mb-1 inline-flex items-center gap-1.5 underline">
                            <FileText className="h-3.5 w-3.5" /> {m.file_name || 'Download File'}
                          </a>
                        )}
                        {m.content && <p className="leading-relaxed">{m.content}</p>}

                        <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] opacity-70">
                          {m.is_edited === 1 && <span>edited</span>}
                          <span>{new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {mine && (m.read_at ? <CheckCheck className="h-3.5 w-3.5 text-[#F5A623]" /> : <Check className="h-3.5 w-3.5" />)}
                          {!m.is_deleted && (
                            <button type="button" onClick={() => setReplyTo(m)} title="Reply">
                              <Reply className="h-3 w-3" />
                            </button>
                          )}
                          {mine && !m.is_deleted && m.message_type === 'text' && (
                            <button type="button" onClick={() => { setEditingMsg(m); setText(m.content); }} title="Edit">
                              <Edit3 className="h-3 w-3" />
                            </button>
                          )}
                          {mine && !m.is_deleted && (
                            <button type="button" onClick={() => handleDeleteMsg(m.id)} title="Delete">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              {/* Composer */}
              <form onSubmit={handleSendText} className="border-t border-slate-200 p-3 bg-white dark:border-slate-800 dark:bg-slate-900">
                {chatError && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {chatError}
                  </div>
                )}
                {(replyTo || editingMsg) && (
                  <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] dark:bg-slate-800">
                    <span>
                      {editingMsg ? `Editing: ${editingMsg.content}` : `Replying to: ${replyTo?.content}`}
                    </span>
                    <button type="button" onClick={() => { setReplyTo(null); setEditingMsg(null); setText(''); }} className="font-bold">
                      Cancel
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                    <Paperclip className="h-4 w-4" />
                    <input type="file" className="hidden" onChange={handleAttachment} />
                  </label>
                  <button
                    type="button"
                    onClick={toggleVoiceRecord}
                    className={`rounded-xl border p-2.5 ${
                      recording
                        ? 'border-red-500 bg-red-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                    }`}
                    title={recording ? 'Stop & Send Voice Note' : 'Record Voice Note'}
                  >
                    {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      sendWs('chat:typing', {
                        conversationId: activeConvId,
                        targetUserId: activeConv.peerId,
                        isTyping: e.target.value.length > 0,
                      });
                    }}
                    placeholder="Write a message..."
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-4 py-2.5 text-xs font-bold text-[#123B65]"
                  >
                    <Send className="h-4 w-4" /> Send
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
              Select a conversation to start messaging or calling.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const WebRTCCallOverlay: React.FC<{
  call: ActiveCallState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onToggleSpeaker: () => void;
}> = ({
  call,
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onEnd,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
  onToggleSpeaker,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (!call) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl">
        {/* Remote Video / Audio Avatar */}
        <div className="relative aspect-video w-full bg-slate-950 flex flex-col items-center justify-center">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={!call.speakerOn}
            className={`h-full w-full object-cover ${call.callType === 'video' && call.status === 'active' ? 'block' : 'hidden'}`}
          />

          {(call.callType === 'audio' || call.status !== 'active') && (
            <div className="text-center p-6">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#123B65] text-2xl font-bold text-[#F5A623] ring-4 ring-[#F5A623]/30">
                {call.peerName.slice(0, 2).toUpperCase()}
              </div>
              <h3 className="text-xl font-bold">{call.peerName}</h3>
              <p className="mt-1 text-xs text-slate-400">
                {call.callType === 'video' ? 'Video Call' : 'Audio Call'} · {call.connectionQuality}
              </p>
            </div>
          )}

          {/* Local Camera Preview */}
          {call.callType === 'video' && localStream && (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-4 right-4 h-28 w-24 rounded-xl border-2 border-[#F5A623] object-cover shadow-lg"
            />
          )}
        </div>

        {/* Call Controls */}
        <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-900 px-6 py-5">
          {call.direction === 'incoming' && call.status === 'ringing' ? (
            <>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-500"
              >
                <PhoneCall className="h-4 w-4" /> Accept
              </button>
              <button
                type="button"
                onClick={onReject}
                className="inline-flex items-center gap-2 rounded-full bg-red-600 px-6 py-3 text-sm font-bold text-white hover:bg-red-500"
              >
                <PhoneOff className="h-4 w-4" /> Reject
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onToggleMic} className={`rounded-full p-3.5 ${call.micMuted ? 'bg-red-600' : 'bg-slate-800 hover:bg-slate-700'}`} title="Mute Mic">
                {call.micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              {call.callType === 'video' && (
                <>
                  <button type="button" onClick={onToggleCamera} className={`rounded-full p-3.5 ${call.cameraOff ? 'bg-red-600' : 'bg-slate-800 hover:bg-slate-700'}`} title="Toggle Camera">
                    {call.cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                  </button>
                  <button type="button" onClick={onSwitchCamera} className="rounded-full bg-slate-800 p-3.5 hover:bg-slate-700" title="Switch Camera">
                    <RefreshCw className="h-5 w-5" />
                  </button>
                </>
              )}
              <button type="button" onClick={onToggleSpeaker} className="rounded-full bg-slate-800 p-3.5 hover:bg-slate-700" title="Speaker">
                {call.speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
              <button type="button" onClick={onEnd} className="inline-flex items-center gap-2 rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold hover:bg-red-500">
                <PhoneOff className="h-5 w-5" /> End Call
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
