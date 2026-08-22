'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { LoginPasswordSettingsModal } from '@/components/admin/login-password-settings-modal';
import { SensitivePasswordSettingsModal } from '@/components/admin/sensitive-password-settings-modal';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type OpenSensitivePasswordOptions = {
  onSaved?: () => void;
};

type AccountSettingsContextValue = {
  openLoginPassword: () => void;
  openSensitivePassword: (options?: OpenSensitivePasswordOptions) => void;
};

const AccountSettingsContext = createContext<AccountSettingsContextValue | null>(null);

export function AccountSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  const [loginPasswordOpen, setLoginPasswordOpen] = useState(false);
  const [sensitivePasswordOpen, setSensitivePasswordOpen] = useState(false);
  const [sensitivePasswordOnSaved, setSensitivePasswordOnSaved] = useState<
    (() => void) | undefined
  >(undefined);

  const openLoginPassword = useCallback(() => {
    setLoginPasswordOpen(true);
  }, []);

  const openSensitivePassword = useCallback(
    (options?: OpenSensitivePasswordOptions) => {
      if (user?.role !== 'enterprise_admin') return;
      setSensitivePasswordOnSaved(() => options?.onSaved);
      setSensitivePasswordOpen(true);
    },
    [user?.role]
  );

  const closeSensitivePassword = useCallback(() => {
    setSensitivePasswordOpen(false);
    setSensitivePasswordOnSaved(undefined);
  }, []);

  const value = useMemo(
    () => ({
      openLoginPassword,
      openSensitivePassword,
    }),
    [openLoginPassword, openSensitivePassword]
  );

  return (
    <AccountSettingsContext.Provider value={value}>
      {children}
      <LoginPasswordSettingsModal
        open={loginPasswordOpen}
        onClose={() => setLoginPasswordOpen(false)}
      />
      <SensitivePasswordSettingsModal
        open={sensitivePasswordOpen}
        onClose={closeSensitivePassword}
        onSaved={sensitivePasswordOnSaved}
      />
    </AccountSettingsContext.Provider>
  );
}

export function useAccountSettings() {
  const context = useContext(AccountSettingsContext);

  return useMemo(
    () => ({
      openLoginPassword: context?.openLoginPassword ?? (() => {}),
      openSensitivePassword: context?.openSensitivePassword ?? (() => {}),
    }),
    [context]
  );
}
