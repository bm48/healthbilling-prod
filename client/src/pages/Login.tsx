import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ArrowLeft, Mail, Lock, LogIn, Eye, EyeOff } from 'lucide-react'

export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  // Show message if user was signed out because account was deactivated
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('login_deactivated') === '1') {
      sessionStorage.removeItem('login_deactivated')
      setError('Your account has been deactivated. Please contact your administrator.')
    }
  }, [])

  // Pre-fill email and password when user opens the invite link (?email=...&invite=token)
  useEffect(() => {
    const inviteToken = searchParams.get('invite')
    const emailParam = searchParams.get('email')
    if (!inviteToken || !emailParam) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/get-invite-credentials?token=${encodeURIComponent(inviteToken)}`)
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || 'Invalid or expired sign-in link.')
          setSearchParams((p) => {
            p.delete('invite')
            return p
          })
          return
        }
        const data = await res.json()
        setEmail(data.email || '')
        setPassword(data.password || '')
        setSearchParams((p) => {
          p.delete('invite')
          return p
        })
      } catch {
        if (!cancelled) setError('Could not load sign-in details.')
      }
    })()
    return () => { cancelled = true }
  }, [searchParams, setSearchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err: any) {
      // Better error messages for common issues
      if (err.message?.includes('Email not confirmed') || err.message?.includes('email_not_confirmed')) {
        setError('Your email is not confirmed. Please check your inbox for a confirmation email, or contact support.')
      } else if (err.message?.includes('Invalid login credentials') || err.message?.includes('invalid_credentials')) {
        setError('Invalid email or password. Please check your credentials and try again.')
      } else {
        setError(err.message || 'Failed to sign in. Please check your credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative"
      style={{
        // backgroundImage: `url('https://images.unsplash.com/photo-1551601651-2a8555f1a136?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-blue-900/85 to-slate-900/90"></div>
      
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative z-10 max-w-xl w-full space-y-8">
        
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
          <div className="text-center mb-8 relative">
            {/* <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full mb-4">
              <LogIn className="text-white" size={32} />
            </div> */}
            
            <Link
              to="/"
              className="absolute -top-6 -left-6 inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors mb-4"
            >
              <ArrowLeft size={20} />
              <span>Back to Home</span>
            </Link>

            <img
              src="/Matrix%20logo.png"
              alt="AMBC Logo"
              width={240}
              height={240}
              className="mx-auto mb-0 max-h-80 w-auto object-cover"
            />

            {/* <h2 className="text-3xl font-extrabold text-white mb-2 pt-4 -mt-20">
              Welcome Back
            </h2>
            <p className="text-sm text-white/70">
              Sign in to your account to continue
            </p> */}
          </div>
          <form className="space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-900/50 border border-red-500/50 p-4 backdrop-blur-sm">
              <div className="text-sm text-red-200">{error}</div>
            </div>
          )}
          <div className="space-y-4 -mt-[3rem]">
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
              <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-2 flex items-center gap-2">
                <Lock size={16} />
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="appearance-none relative block w-full px-4 py-3 pl-10 pr-11 border border-white/20 bg-white/10 backdrop-blur-sm placeholder-white/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm transition-all"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-white/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:ring-offset-transparent"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
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
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>Sign in</span>
                </>
              )}
            </button>
            
            <div className="text-center">
              <p className="text-sm text-white/70">
                Don't have an account?{' '}
                <Link to="/signup" className="font-medium text-primary-400 hover:text-primary-300 transition-colors">
                  email office@amerbilling.com
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
