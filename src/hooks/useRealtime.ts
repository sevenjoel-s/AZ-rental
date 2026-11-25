import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ChatMessage, NotificationItem, User } from '../types';

export interface ActiveCallState {
  callId: number | null;
  peerId: number;
  peerName: string;
  callType: 'audio' | 'video';
  direction: 'outgoing' | 'incoming';
  status: 'ringing' | 'connecting' | 'active' | 'ended';
  offer?: RTCSessionDescriptionInit;
  startedAt?: number;
  micMuted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  facingMode: 'user' | 'environment';
  connectionQuality: string;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function playAlertTone(kind: 'notification' | 'ring', volume = 0.6, muted = false) {
  if (muted || volume <= 0 || typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = Math.min(1, Math.max(0.05, volume * 0.25));
    if (kind === 'ring') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.16);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(784, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
    }
  } catch {
    // autoplay blocked before user gesture
  }
}

export function useRealtime(params: {
  user: User | null;
  soundEnabled: boolean;
  soundVolume: number;
  onNewMessage?: (msg: ChatMessage) => void;
  onMessageEdit?: (msg: ChatMessage) => void;
  onMessageDelete?: (payload: { id: number; conversation_id: number }) => void;
  onMessagesRead?: (payload: { conversationId: number; readerId: number }) => void;
  onTyping?: (payload: { conversationId: number; userId: number; isTyping: boolean }) => void;
  onNewNotification?: (notif: NotificationItem) => void;
  onCallError?: (payload: { code?: string; error: string }) => void;
}) {
  const { user, soundEnabled, soundVolume } = params;
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const [onlineUserIds, setOnlineUserIds] = useState<number[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const activeCallRef = useRef<ActiveCallState | null>(null);
  activeCallRef.current = activeCall;

  const callbacksRef = useRef(params);
  callbacksRef.current = params;

  const cleanupCallMedia = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const sendWs = useCallback((event: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const buildPeerConnection = useCallback(
    (peerId: number, callId: number | null) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const rStream = new MediaStream();
      remoteStreamRef.current = rStream;
      setRemoteStream(rStream);

      pc.ontrack = (evt) => {
        evt.streams[0]?.getTracks().forEach((track) => {
          rStream.addTrack(track);
        });
        setRemoteStream(new MediaStream(rStream.getTracks()));
      };

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          sendWs('call:ice-candidate', {
            callId: activeCallRef.current?.callId || callId,
            targetUserId: peerId,
            candidate: evt.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                connectionQuality:
                  st === 'connected' ? 'HD Connected' : st === 'connecting' ? 'Connecting...' : st,
                status: st === 'connected' ? 'active' : prev.status,
              }
            : null
        );
      };

      pcRef.current = pc;
      return pc;
    },
    [sendWs]
  );

  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      setOnlineUserIds([]);
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      try {
        const { ticket } = await apiFetch<{ ticket: string }>('/api/auth/ws-ticket', { method: 'POST' });
        if (cancelled) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          if (!cancelled) {
            reconnectTimer = setTimeout(connect, 3000);
          }
        };

        ws.onmessage = async (evt) => {
          try {
            const { event, payload } = JSON.parse(evt.data);
            if (event === 'presence:update') {
              setOnlineUserIds(payload.onlineUserIds || []);
            } else if (event === 'chat:message') {
              if (payload.sender_id !== user.id) {
                playAlertTone('notification', callbacksRef.current.soundVolume, !callbacksRef.current.soundEnabled);
              }
              callbacksRef.current.onNewMessage?.(payload);
            } else if (event === 'chat:edit') {
              callbacksRef.current.onMessageEdit?.(payload);
            } else if (event === 'chat:delete') {
              callbacksRef.current.onMessageDelete?.(payload);
            } else if (event === 'chat:read') {
              callbacksRef.current.onMessagesRead?.(payload);
            } else if (event === 'chat:typing') {
              callbacksRef.current.onTyping?.(payload);
            } else if (event === 'notification:new') {
              playAlertTone('notification', callbacksRef.current.soundVolume, !callbacksRef.current.soundEnabled);
              callbacksRef.current.onNewNotification?.(payload);
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(payload.title || 'AZ RENTAL', {
                  body: payload.body || '',
                  icon: '/pwa-192x192.png',
                });
              }
            } else if (event === 'call:created') {
              setActiveCall((prev) => (prev ? { ...prev, callId: payload.callId } : null));
            } else if (event === 'call:incoming') {
              playAlertTone('ring', callbacksRef.current.soundVolume, !callbacksRef.current.soundEnabled);
              setActiveCall({
                callId: payload.callId,
                peerId: payload.callerId,
                peerName: payload.callerName,
                callType: payload.callType,
                direction: 'incoming',
                status: 'ringing',
                offer: payload.offer,
                micMuted: false,
                cameraOff: payload.callType !== 'video',
                speakerOn: true,
                facingMode: 'user',
                connectionQuality: 'Incoming call...',
              });
            } else if (event === 'call:answered') {
              if (pcRef.current && payload.answer) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
                for (const cand of pendingIceRef.current) {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
                }
                pendingIceRef.current = [];
              }
              setActiveCall((prev) =>
                prev ? { ...prev, status: 'active', startedAt: Date.now(), connectionQuality: 'Connected' } : null
              );
            } else if (event === 'call:ice-candidate') {
              if (payload.candidate) {
                if (pcRef.current && pcRef.current.remoteDescription) {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
                } else {
                  pendingIceRef.current.push(payload.candidate);
                }
              }
            } else if (event === 'call:rejected' || event === 'call:ended' || event === 'call:unavailable') {
              cleanupCallMedia();
              setActiveCall(null);
            } else if (event === 'call:error') {
              cleanupCallMedia();
              setActiveCall(null);
              callbacksRef.current.onCallError?.(payload);
            }
          } catch {
            // ignore bad message
          }
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      cleanupCallMedia();
    };
  }, [user?.id, cleanupCallMedia]);

  const startCall = useCallback(
    async (peerId: number, peerName: string, callType: 'audio' | 'video', conversationId?: number) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? { facingMode: 'user' } : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = buildPeerConnection(peerId, null);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setActiveCall({
        callId: null,
        peerId,
        peerName,
        callType,
        direction: 'outgoing',
        status: 'ringing',
        micMuted: false,
        cameraOff: callType !== 'video',
        speakerOn: true,
        facingMode: 'user',
        connectionQuality: 'Calling...',
      });

      sendWs('call:initiate', {
        calleeId: peerId,
        callType,
        conversationId,
        offer,
      });
    },
    [buildPeerConnection, sendWs]
  );

  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || !call.offer || !call.callId) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: call.callType === 'video' ? { facingMode: 'user' } : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);

    const pc = buildPeerConnection(call.peerId, call.callId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
    for (const cand of pendingIceRef.current) {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    }
    pendingIceRef.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendWs('call:answer', {
      callId: call.callId,
      callerId: call.peerId,
      answer,
    });

    setActiveCall((prev) =>
      prev ? { ...prev, status: 'active', startedAt: Date.now(), connectionQuality: 'Connected' } : null
    );
  }, [buildPeerConnection, sendWs]);

  const rejectCall = useCallback(() => {
    const call = activeCallRef.current;
    if (call?.callId) {
      sendWs('call:reject', { callId: call.callId, callerId: call.peerId });
    }
    cleanupCallMedia();
    setActiveCall(null);
  }, [cleanupCallMedia, sendWs]);

  const endCall = useCallback(() => {
    const call = activeCallRef.current;
    if (call?.callId) {
      sendWs('call:end', { callId: call.callId });
    }
    cleanupCallMedia();
    setActiveCall(null);
  }, [cleanupCallMedia, sendWs]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const nextMuted = !(activeCallRef.current?.micMuted ?? false);
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    setActiveCall((prev) => (prev ? { ...prev, micMuted: nextMuted } : null));
  }, []);

  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const nextOff = !(activeCallRef.current?.cameraOff ?? false);
    localStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = !nextOff;
    });
    setActiveCall((prev) => (prev ? { ...prev, cameraOff: nextOff } : null));
  }, []);

  const switchCamera = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || call.callType !== 'video' || !pcRef.current) return;
    const nextFacing = call.facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);
      }
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      if (localStreamRef.current && newTrack) {
        localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
        localStreamRef.current.addTrack(newTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
      setActiveCall((prev) => (prev ? { ...prev, facingMode: nextFacing } : null));
    } catch {
      // single camera device
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setActiveCall((prev) => (prev ? { ...prev, speakerOn: !prev.speakerOn } : null));
  }, []);

  return {
    wsConnected,
    onlineUserIds,
    activeCall,
    localStream,
    remoteStream,
    sendWs,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchCamera,
    toggleSpeaker,
  };
}
