import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { FileText, Users, BarChart3, Shield, CheckCircle, ArrowRight, Sparkles } from 'lucide-react'

export default function Landing() {
  const { user } = useAuth()

  return (
    <div 
      className="min-h-screen relative"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1551601651-2a8555f1a136?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80')`,
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

      {/* Header */}
      <header className="relative z-10 bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
                <FileText className="text-white" size={24} />
              </div>
              <h1 className="text-2xl font-bold text-white">Health Billing</h1>
            </div>
            <div className="flex gap-4">
              {user ? (
                <Link
                  to="/dashboard"
                  className="px-6 py-2.5 bg-white text-primary-600 rounded-lg hover:bg-primary-50 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                >
                  Go to Dashboard
                </Link>
              ) : (
                <div className="flex gap-3">
                  <Link
                    to="/signup"
                    className="px-6 py-2.5 bg-white/10 backdrop-blur-sm text-white rounded-lg hover:bg-white/20 transition-all duration-200 font-semibold border border-white/20"
                  >
                    Sign Up
                  </Link>
                  <Link
                    to="/login"
                    className="px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-lg hover:from-primary-600 hover:to-primary-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    Sign In
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 mb-6">
            <Sparkles className="text-yellow-300" size={16} />
            <span className="text-white/90 text-sm font-medium">Trusted by Healthcare Providers</span>
          </div>
          
          <h2 className="text-6xl md:text-7xl font-extrabold text-white mb-6 leading-tight">
            Streamline Your
            <span className="block bg-gradient-to-r from-primary-400 via-blue-400 to-primary-400 bg-clip-text text-transparent">
              Healthcare Billing
            </span>
          </h2>
          
          <p className="text-xl md:text-2xl text-white/80 max-w-3xl mx-auto mb-10 leading-relaxed">
            A comprehensive billing management system designed for healthcare providers,
            clinics, and billing staff to manage patient data, claims, and financial records efficiently.
          </p>

          {!user && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                to="/login"
                className="group px-8 py-4 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all duration-200 font-semibold text-lg shadow-2xl hover:shadow-primary-500/50 transform hover:-translate-y-1 flex items-center gap-2"
              >
                Get Started
                <ArrowRight className="group-hover:translate-x-1 transition-transform" size={20} />
              </Link>
              <button className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white rounded-xl hover:bg-white/20 transition-all duration-200 font-semibold text-lg border border-white/20">
                Learn More
              </button>
            </div>
          )}
        </div>

        {/* Stats Section */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
          {[
            { number: '100%', label: 'Secure' },
            { number: '24/7', label: 'Available' },
            { number: '99.9%', label: 'Uptime' },
            { number: '500+', label: 'Users' },
          ].map((stat, idx) => (
            <div key={idx} className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 text-center hover:bg-white/15 transition-all duration-200">
              <div className="text-3xl font-bold text-white mb-2">{stat.number}</div>
              <div className="text-white/70 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {[
            {
              icon: FileText,
              title: 'Provider Sheets',
              description: 'Manage provider schedules, billing codes, and appointment statuses with ease.',
              gradient: 'from-blue-500 to-cyan-500',
            },
            {
              icon: Users,
              title: 'Patient Database',
              description: 'Maintain comprehensive patient records and track billing information.',
              gradient: 'from-purple-500 to-pink-500',
            },
            {
              icon: BarChart3,
              title: 'Reports & Analytics',
              description: 'Generate detailed reports for providers, clinics, claims, and financial analysis.',
              gradient: 'from-green-500 to-emerald-500',
            },
            {
              icon: Shield,
              title: 'Secure & Role-Based',
              description: 'Role-based access control ensures data security and appropriate permissions.',
              gradient: 'from-orange-500 to-red-500',
            },
          ].map((feature, idx) => {
            const Icon = feature.icon
            return (
              <div
                key={idx}
                className="group bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl"
              >
                <div className={`w-16 h-16 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                  <Icon className="text-white" size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-white/70 leading-relaxed">{feature.description}</p>
              </div>
            )
          })}
        </div>

        {/* Benefits Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-12 border border-white/20 mb-20">
          <h3 className="text-4xl font-bold text-white text-center mb-12">
            Why Choose Health Billing?
          </h3>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              'HIPAA Compliant Security',
              'Real-time Data Synchronization',
              'Comprehensive Audit Trails',
              'Multi-clinic Management',
              'Automated Report Generation',
              'Role-based Access Control',
            ].map((benefit, idx) => (
              <div key={idx} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
                  <CheckCircle className="text-white" size={20} />
                </div>
                <p className="text-white/90 text-lg font-medium">{benefit}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        {!user && (
          <div className="relative bg-gradient-to-r from-primary-600 via-blue-600 to-primary-600 rounded-3xl p-12 text-center overflow-hidden">
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V4h4V2h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V4h4V2H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
              }}
            ></div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold text-white mb-4">
                Ready to get started?
              </h3>
              <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
                Sign in to access your billing dashboard and start managing your healthcare billing with confidence.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-3 px-10 py-5 bg-white text-primary-600 rounded-xl hover:bg-primary-50 transition-all duration-200 font-bold text-lg shadow-2xl hover:shadow-white/50 transform hover:-translate-y-1"
              >
                Sign In Now
                <ArrowRight size={24} />
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 bg-black/20 backdrop-blur-sm border-t border-white/10 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-center text-white/60">
            © {new Date().getFullYear()} Health Billing. All rights reserved.
          </p>
        </div>
      </footer>

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
