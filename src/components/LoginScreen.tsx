/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { KeyRound, ShieldAlert, ArrowRight, UserCheck } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginScreenProps {
  onLogin: (userId: string, role: 'user' | 'admin') => void;
  isLoggingIn?: boolean;
  loginError?: string | null;
  adminEmails?: string[];
  allowedUsers?: any[];
  onGoogleSignIn?: () => Promise<void>;
}

// Credentials mapping specified by user
const CREDENTIALS: Record<string, { passkey: string; role: 'user' | 'admin' }> = {
  "1859": { passkey: "0069", role: "user" },
  "9531": { passkey: "4949", role: "user" },
  "5595": { passkey: "9231", role: "user" },
  "4001": { passkey: "1793", role: "user" },
  "8888": { passkey: "2010", role: "admin" }
};

export default function LoginScreen({
  onLogin,
  isLoggingIn = false,
  loginError = null,
  allowedUsers = [],
}: LoginScreenProps) {
  const [idInput, setIdInput] = useState('');
  const [passkeyInput, setPasskeyInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const enteredId = idInput.trim();
    const enteredPass = passkeyInput.trim();

    if (!enteredId || !enteredPass) {
      setErrorMsg('Please enter both User ID and Passkey.');
      return;
    }

    const matched = CREDENTIALS[enteredId];
    if (matched) {
      if (matched.passkey !== enteredPass) {
        setErrorMsg('Incorrect Passkey for this ID.');
        return;
      }
      onLogin(enteredId, matched.role);
    } else {
      // Check dynamically inside allowedUsers fetched from Google Sheet
      const isDynamicUser = allowedUsers && allowedUsers.some(u => u.email && u.email.trim().toLowerCase() === enteredId.toLowerCase());
      if (isDynamicUser) {
        onLogin(enteredId, 'user');
      } else {
        setErrorMsg('Invalid User or Admin ID. Please ensure your User ID is assigned in the spreadsheet.');
      }
    }
  };

  const activeError = errorMsg || loginError;

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-200">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md space-y-6"
      >
        {/* Brand Banner */}
        <div className="text-center pb-2">
          <img 
            src="https://assetscout.in/assets/images/Assetscout%20Logo%20Black.webp" 
            alt="Assetscout Logo" 
            className="h-10 sm:h-12 w-auto object-contain block mx-auto"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Main login card */}
        <div className="bg-white p-8 rounded-3xl border border-gray-150 shadow-md space-y-6 relative overflow-hidden">
          <div className="space-y-1.5 text-center">
            <h2 className="text-base font-bold text-gray-900 font-sans">Authenticate Session</h2>
            <p className="text-xs text-gray-500">Sign in using your assigned User ID and Passkey.</p>
          </div>

          {activeError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold leading-relaxed">
              {activeError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-id" className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                User / Admin ID
              </label>
              <input
                id="login-id"
                type="text"
                required
                autoFocus
                placeholder="Your ID"
                value={idInput}
                onChange={(e) => {
                  setIdInput(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-gray-950 font-semibold placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-650 transition text-sm sm:text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-passkey" className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Passkey
              </label>
              <input
                id="login-passkey"
                type="password"
                required
                placeholder="••••"
                value={passkeyInput}
                onChange={(e) => {
                  setPasskeyInput(e.target.value);
                  setErrorMsg(null);
                }}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-gray-950 font-semibold placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-650 transition text-sm sm:text-xs"
              />
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="w-full px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              Enter Workspace
              <ArrowRight size={13} />
            </button>
          </form>

        </div>

        {/* Security / Sheets info indicator footer */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400 font-semibold font-mono">
          <span className="flex items-center gap-1">
            <ShieldAlert size={12} /> Secure login session
          </span>
        </div>
      </motion.div>
    </div>
  );
}
