import React, { useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, User } from 'lucide-react';
import { useSession } from '../auth/SessionContext';
import type { SessionUser } from '../types/user';

interface LoginScreenProps {
  onSuccess?: (user: SessionUser) => void;
  onForgotPassword: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, onForgotPassword }) => {
  const { login } = useSession();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await login(loginId, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError('');
      onSuccess?.(result.session);
    } finally {
      setSubmitting(false);
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950 overflow-hidden">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(37, 99, 235, 0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.25), transparent 45%)',
        }}
      />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-8 w-full max-w-md text-center border border-slate-200 dark:border-slate-700">
        <div className="mx-auto mb-3 flex items-center justify-center">
          <img
            src="/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg"
            alt="Median Research & Consulting Pvt Ltd"
            className="h-16 w-auto max-w-[220px] object-contain rounded-lg bg-white p-1"
          />
        </div>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mb-0.5 leading-snug">
          Median Research &amp; Consulting Pvt Ltd
        </h1>
        <p className="text-[11px] font-bold text-blue-700 dark:text-sky-400 mb-1 tracking-wide uppercase">
          Median Asset &amp; HR Suite
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
          Sign in with your Login ID or Email and password
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4 text-left">
          <div>
            <label
              htmlFor="login-id"
              className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1"
            >
              Login ID or Email
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                <User className="w-3.5 h-3.5" />
              </span>
              <input
                id="login-id"
                type="text"
                autoComplete="username"
                value={loginId}
                onChange={(e) => {
                  setLoginId(e.target.value);
                  if (error) setError('');
                }}
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none"
                placeholder="Enter your Login ID or Email"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1"
            >
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                <Lock className="w-3.5 h-3.5" />
              </span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none"
                placeholder="Enter your password"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-rose-600 font-medium">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end text-[11px]">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-slate-500 hover:text-blue-700 dark:text-slate-400 dark:hover:text-sky-400 font-medium cursor-pointer"
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center space-x-2 cursor-pointer"
          >
            <LockOpen className="w-3.5 h-3.5" />
            <span>{submitting ? 'Signing In...' : 'Sign In to Median Asset & HR Suite'}</span>
          </button>
        </form>

        <p className="text-[10px] text-slate-400 mt-5">
          JWT Authenticated Session · RBAC Enabled
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          Median Research &amp; Consulting Pvt Ltd · &copy; {currentYear}
        </p>
      </div>
    </div>
  );
};