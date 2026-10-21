// 로그인 후 홈 탭에서 한 번 — 펀드가 없어도 새 글 알림 권한을 묻는다(기록 wasPrompted 는 펀드 경로와 공유)
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';

import { isPushConfigured } from './config';
import { wasPrompted } from './prompt';
import { effectivePermission, shouldPromptOnHome } from './prompt-core';
import { PushPromptSheet } from './push-prompt-sheet';

export function HomePushPrompt() {
  const loggedIn = useAuthStore((s) => s.user !== null);
  const hydrated = useAuthStore((s) => s.hydrated);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false); // 포커스가 다시 와도 열린 시트를 또 열지 않게
  openRef.current = open;

  useFocusEffect(
    useCallback(() => {
      if (!hydrated || !loggedIn || !isPushConfigured()) return;
      let alive = true;
      void Promise.all([wasPrompted(), Notifications.getPermissionsAsync()])
        .then(([prompted, perm]) => {
          if (!alive || openRef.current) return;
          const permission = effectivePermission(perm); // Android 13+ 미요청 'denied' 보정
          if (shouldPromptOnHome({ loggedIn, prompted, permission, configured: true })) setOpen(true);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [hydrated, loggedIn]),
  );

  return open ? <PushPromptSheet onClose={() => setOpen(false)} /> : null;
}
