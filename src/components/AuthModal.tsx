import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { apiFetch, setAccessToken } from '../lib/api';
import type { LanguageCode, LocationItem, ServiceFeeConfig, User } from '../types';
import { ServicePassPanel } from './ServicePassModal';

interface Props {
  isOpen: boolean;
  initialMode?: 'login' | 'register_renter' | 'register_landlord' | 'admin_setup';
  lang?: LanguageCode;
  locations: LocationItem[];
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<Props> = ({
  isOpen,
  initialMode = 'login',
  lang = 'en',
  locations,
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<
    'login' | 'register_renter' | 'register_landlord' | 'otp' | 'service_pass' | 'reset' | 'admin_setup'
  >(initialMode);
  const [feeConfig, setFeeConfig] = useState<ServiceFeeConfig>({ amountEtb: 50, durationDays: 30 });
  const [hasSuperAdmin, setHasSuperAdmin] = useState(true);
  const [envPasscodeRequired, setEnvPasscodeRequired] = useState(false);

  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('Ethiopia');
  const [city, setCity] = useState('Addis Ababa');
  const [address, setAddress] = useState('');
  const [accountType, setAccountType] = useState<'individual' | 'business'>('individual');
  const [businessName, setBusinessName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');

  const [otpTarget, setOtpTarget] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpPreview, setOtpPreview] = useState<string | null>(null);
  const [otpPurpose, setOtpPurpose] = useState<'verify' | 'password_reset'>('verify');
  const [pendingUser, setPendingUser] = useState<User | null>(null);

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setInfo('');
  }, [initialMode, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch<{ hasSuperAdmin: boolean; envPasscodeConfigured: boolean }>('/api/auth/admin-bootstrap-status')
      .then((res) => {
        setHasSuperAdmin(res.hasSuperAdmin);
        setEnvPasscodeRequired(res.envPasscodeConfigured);
      })
      .catch(() => {});
    apiFetch<ServiceFeeConfig>('/api/subscription/config')
      .then((cfg) => {
        if (cfg?.amountEtb) setFeeConfig(cfg);
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const uniqueCities = Array.from(new Set(locations.map((l) => l.city)));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ contact, password }),
      });
      setAccessToken(res.token);
      onSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent, role: 'renter' | 'landlord') => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!termsAccepted) {
      setError('Please accept the AZ RENTAL Terms & Conditions.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{
        user: User;
        token: string;
        verificationTarget: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          contact,
          password,
          confirmPassword,
          role,
          country,
          city,
          address,
          accountType,
          businessName,
          licenseNumber,
          termsAccepted,
        }),
      });
      setAccessToken(res.token);
      setPendingUser(res.user);
      setOtpTarget(res.verificationTarget);
      setOtpPurpose('verify');

      // Automatically dispatch OTP for verification
      const otpRes = await apiFetch<{ previewCode?: string; channel: string }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ contact: res.verificationTarget, purpose: 'verify' }),
      });
      setOtpPreview(otpRes.previewCode || null);
      setInfo(`Verification code sent via ${otpRes.channel.toUpperCase()} to ${res.verificationTarget}.`);
      setMode('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (otpPurpose === 'password_reset') {
        await apiFetch('/api/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ contact: otpTarget, code: otpCode, newPassword: password }),
        });
        setInfo('Password updated. You can now sign in.');
        setMode('login');
      } else {
        const res = await apiFetch<{ user: User | null }>('/api/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ contact: otpTarget, code: otpCode, purpose: 'verify' }),
        });
        const verifiedUser = res.user || pendingUser;
        if (verifiedUser) {
          setPendingUser(verifiedUser);
          onSuccess(verifiedUser);
          if (!verifiedUser.subscription_active) {
            setInfo(
              `Verification complete! Pay ${feeConfig.amountEtb} ETB to activate your 1-month (${feeConfig.durationDays} days) AZ RENTAL pass.`
            );
            setMode('service_pass');
            return;
          }
        }
        onClose();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setInfo('');
    try {
      const res = await apiFetch<{ previewCode?: string; channel: string }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ contact: otpTarget, purpose: otpPurpose }),
      });
      setOtpPreview(res.previewCode || null);
      setInfo(`New OTP dispatched via ${res.channel.toUpperCase()}.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ target: string; previewCode?: string }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ contact, purpose: 'password_reset' }),
      });
      setOtpTarget(res.target);
      setOtpPurpose('password_reset');
      setOtpPreview(res.previewCode || null);
      setMode('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/admin-bootstrap', {
        method: 'POST',
        body: JSON.stringify({ fullName, email: contact, password, passcode: adminPasscode }),
      });
      setAccessToken(res.token);
      onSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div
        className={`relative w-full ${
          mode === 'service_pass' ? 'max-w-3xl' : 'max-w-lg'
        } rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close authentication modal"
          className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <img
            src="/assets/aistudio/Glossy_AZ_Rental_App_Icon_2ee6fab8.png"
            alt="AZ RENTAL"
            className="h-10 w-10 rounded-xl object-cover"
          />
          <div>
            <h2 className="text-xl font-bold text-[#123B65] dark:text-white">
              {mode === 'login' && 'Sign in to AZ RENTAL'}
              {mode === 'register_renter' && 'Renter Registration'}
              {mode === 'register_landlord' && 'Landlord / Owner Registration'}
              {mode === 'otp' && 'Verify Email or Phone OTP'}
              {mode === 'service_pass' && `Activate ${feeConfig.amountEtb} ETB 1-Month Pass`}
              {mode === 'reset' && 'Reset Password'}
              {mode === 'admin_setup' && 'Claim Super Admin Account'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Find Your Place. Connect Directly. · ቤትዎን በቀላሉ ያግኙ!
            </p>
          </div>
        </div>

        {/* Role & Auth Mode Tabs */}
        {['login', 'register_renter', 'register_landlord'].includes(mode) && (
          <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('register_renter'); setError(''); }}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                mode === 'register_renter'
                  ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Renter Signup
            </button>
            <button
              type="button"
              onClick={() => { setMode('register_landlord'); setError(''); }}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                mode === 'register_landlord'
                  ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Landlord Signup
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
            {info}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email or Ethiopian Phone (+251 / 09...)
              </label>
              <input
                type="text"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="name@example.com or 0911223344"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#123B65] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#123B65] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); }}
                className="font-medium text-[#123B65] hover:underline dark:text-[#F5A623]"
              >
                Forgot password?
              </button>
              {!hasSuperAdmin && (
                <button
                  type="button"
                  onClick={() => { setMode('admin_setup'); setError(''); }}
                  className="inline-flex items-center gap-1 font-semibold text-amber-600 hover:underline dark:text-amber-400"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Setup First Super Admin
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#123B65] py-3 text-sm font-bold text-white hover:bg-[#0f3154] disabled:opacity-60 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {(mode === 'register_renter' || mode === 'register_landlord') && (
          <form
            onSubmit={(e) => handleRegister(e, mode === 'register_landlord' ? 'landlord' : 'renter')}
            className="space-y-3.5 max-h-[65vh] overflow-y-auto pr-1"
          >
            <div className="rounded-xl border border-[#F5A623]/40 bg-[#F5A623]/10 px-3.5 py-2.5 text-xs text-[#123B65] dark:text-amber-200">
              <strong>Membership Fee: {feeConfig.amountEtb} ETB / Month ({feeConfig.durationDays} Days)</strong>
              <p className="mt-0.5 text-[11px] opacity-90">
                New accounts pay {feeConfig.amountEtb} ETB for 1 month of full access. After 1 month, sign in with your existing account and pay {feeConfig.amountEtb} ETB service renewal to continue — no new registration needed.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Abebe Kebede"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email Address or Phone Number *
              </label>
              <input
                type="text"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="abebe@example.com or +251911..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Password (min 8 chars) *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Country
                </label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  City *
                </label>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {(uniqueCities.length ? uniqueCities : ['Addis Ababa', 'Adama', 'Hawassa', 'Bahir Dar', 'Dire Dawa']).map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            {mode === 'register_landlord' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Account Type
                    </label>
                    <select
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value as 'individual' | 'business')}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="individual">Individual Owner</option>
                      <option value="business">Business / Agency</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Address / Sub-City
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Bole, Woreda 03"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {accountType === 'business' ? 'Business Name' : 'National ID / Kebele ID (Optional)'}
                    </label>
                    <input
                      type="text"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder={accountType === 'business' ? 'Ethio Homes PLC' : 'ID Reference'}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      License / TIN Number (Optional)
                    </label>
                    <input
                      type="text"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      placeholder="BL-102938"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              </>
            )}

            <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#123B65]"
              />
              <span>
                I accept the AZ RENTAL Terms & Conditions, Written Rental Agreement policy (በውል የከራዩ), and Anti-Fraud rules.
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#F5A623] py-3 text-sm font-bold text-[#123B65] hover:bg-[#e59816] disabled:opacity-60 transition-colors"
            >
              {loading
                ? 'Creating account...'
                : mode === 'register_landlord'
                ? 'Register as Landlord & Verify OTP'
                : 'Register as Renter & Verify OTP'}
            </button>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
              <div className="flex items-center gap-2 font-semibold text-[#123B65] dark:text-[#F5A623]">
                <ShieldCheck className="h-4 w-4" />
                Verification Target: {otpTarget}
              </div>
              {otpPreview && (
                <p className="mt-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                  Preview Sandbox OTP Code: <strong className="text-sm">{otpPreview}</strong>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Enter 6-Digit OTP Code
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.35em] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {otpPurpose === 'password_reset' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#123B65] py-3 text-sm font-bold text-white hover:bg-[#0f3154]"
              >
                <CheckCircle2 className="h-4 w-4" />
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                Resend
              </button>
            </div>

            {pendingUser && (
              <button
                type="button"
                onClick={() => {
                  onSuccess(pendingUser);
                  if (!pendingUser.subscription_active) {
                    setMode('service_pass');
                  } else {
                    onClose();
                  }
                }}
                className="w-full text-center text-xs text-slate-500 hover:underline"
              >
                Verify later & continue to {feeConfig.amountEtb} ETB Service Pass
              </button>
            )}
          </form>
        )}

        {mode === 'service_pass' && pendingUser && (
          <ServicePassPanel
            user={pendingUser}
            lang={lang}
            onUserUpdated={(updated) => {
              setPendingUser(updated);
              onSuccess(updated);
            }}
            onDone={onClose}
          />
        )}

        {mode === 'reset' && (
          <form onSubmit={handleRequestReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Registered Email or Phone
              </label>
              <input
                type="text"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="name@example.com or +251911..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-[#123B65] py-3 text-sm font-bold text-white"
              >
                Send Reset OTP
              </button>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold dark:border-slate-700"
              >
                Back
              </button>
            </div>
          </form>
        )}

        {mode === 'admin_setup' && (
          <form onSubmit={handleAdminBootstrap} className="space-y-3.5">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-200">
              First-run setup: Claim the primary Super Admin account for AZ RENTAL. Once claimed, this setup form locks permanently.
            </div>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Super Admin Full Name"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="email"
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="admin@azrental.et"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Strong password (min 8 chars)"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            {envPasscodeRequired && (
              <input
                type="password"
                required
                value={adminPasscode}
                onChange={(e) => setAdminPasscode(e.target.value)}
                placeholder="Environment ADMIN_PASSCODE"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#123B65] py-3 text-sm font-bold text-white"
              >
                <UserCheck className="h-4 w-4" />
                Claim Super Admin
              </button>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold dark:border-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
