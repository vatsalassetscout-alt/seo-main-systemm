/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, setPersistence, browserSessionPersistence, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Tie the Google/Firebase session to THIS TAB ONLY (sessionStorage-backed).
// This means: pasting the same link into a new tab will NOT be auto-logged-in,
// but refreshing (F5) the current tab WILL keep the session, since sessionStorage
// survives a refresh but is never shared with a newly opened tab.
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error('Failed to set session persistence:', err);
});

export const provider = new GoogleAuthProvider();

// Flag to track sign-in state
let isSigningIn = false;

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, null);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Start Google sign-in redirect or popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    return { user: result.user, accessToken: null };
  } catch (error) {
    console.error('OAuth login failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return null;
};

export const logout = async () => {
  await auth.signOut();
};
