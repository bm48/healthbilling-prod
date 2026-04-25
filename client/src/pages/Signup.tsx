import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ArrowLeft, Mail, Lock, UserPlus, User } from 'lucide-react'
import { UserRole } from '@/types'

const USER_ROLES: { value: UserRole; label: string; description: string }[] = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access to assigned clinics, AR management, month close',
  },
  // {
  //   value: 'view_only_admin',
  //   label: 'View-Only Admin',
  //   description: 'Read-only access to all clinic data',
  // },
  {
    value: 'billing_staff',
    label: 'Billing Staff',
    description: 'Edit billing data, manage To-Do list, timecards',
  },
  // {
  //   value: 'view_only_billing',
  //   label: 'View-Only Billing',
  //   description: 'View-only access to provider sheets',
  // },
  {
    value: 'provider',
    label: 'Provider',
    description: 'Edit own schedule and billing codes (Columns A-I)',
  },
  {
    value: 'office_staff',
    label: 'Office Staff',
    description: 'Manage schedules and patient payments for one clinic',
  },
]

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>('provider')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (!fullName.trim()) {
      setError('Full name is required')
      return
    }

    setLoading(true)

    try {
      // Sign up via API (creates public.users with password hash)
      await signUp(email, password, fullName, selectedRole)
      navigate('/login', { 
        state: { message: 'Account created successfully! Please sign in.' } 
      })
    } catch (err: any) {
      setError(err.message || 'Failed to create account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1551601651-2a8555f1a136?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-blue-900/85 to-slate-900/90"></div>

      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative z-10 max-w-2xl w-full space-y-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={20} />
          <span>Back to Home</span>
        </Link>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full mb-4">
              <UserPlus className="text-white" size={32} />
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-2">Create Account</h2>
            <p className="text-sm text-white/70">Sign up to get started with HealthBilling</p>
          </div>

          {error && (
            <div className="rounded-md bg-red-900/50 border border-red-500/50 p-4 backdrop-blur-sm mb-6">
              <div className="text-sm text-red-200">{error}</div>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="full-name" className="block text-sm font-medium text-white/90 mb-2 flex items-center gap-2">
                  <User size={16} />
                  Full Name
                </label>
                <input
                  id="full-name"
                  name="fullName"
                  type="text"
                  required
                  className="appearance-none relative block w-full px-4 py-3 pl-10 border border-white/20 bg-white/10 backdrop-blur-sm placeholder-white/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="email-address" className="block text-sm font-medium text-white/90 mb-2 flex items-center gap-2">
                  <Mail size={16} />
                  Email address
                </label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="appearance-none relative block w-full px-4 py-3 pl-10 border border-white/20 bg-white/10 backdrop-blur-sm placeholder-white/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-white/90 mb-2">
                  User Role
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {USER_ROLES.map((role) => (
                    <label
                      key={role.value}
                      className={`relative flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedRole === role.value
                          ? 'border-primary-500 bg-primary-500/20'
                          : 'border-white/20 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={role.value}
                        checked={selectedRole === role.value}
                        onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                        className="sr-only"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-white mb-1">{role.label}</div>
                        <div className="text-xs text-white/70">{role.description}</div>
                      </div>
                      {selectedRole === role.value && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-2 flex items-center gap-2">
                  <Lock size={16} />
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none relative block w-full px-4 py-3 pl-10 border border-white/20 bg-white/10 backdrop-blur-sm placeholder-white/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-white/90 mb-2 flex items-center gap-2">
                  <Lock size={16} />
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none relative block w-full px-4 py-3 pl-10 border border-white/20 bg-white/10 backdrop-blur-sm placeholder-white/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={18} />
                    <span>Create Account</span>
                  </>
                )}
              </button>

              <div className="text-center">
                <p className="text-sm text-white/70">
                  Already have an account?{' '}
                  <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300 transition-colors">
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          </form>
        </div>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  )
}
