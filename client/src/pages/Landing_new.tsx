import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import { Circle, ArrowUp } from 'lucide-react'
import 'aos/dist/aos.css'

const SCROLL_THRESHOLD_PX = 300
const AOS_OFFSET = 40
const AOS_DURATION = 600

export default function Landing() {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)
  const [headerVisible, setHeaderVisible] = useState(true)
  const [showScrollToTop, setShowScrollToTop] = useState(false)

  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactContent, setContactContent] = useState('')
  const [contactSubmitted, setContactSubmitted] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setContactError(null)
    setContactLoading(true)
    try {
      const body = {
        name: contactName,
        email: contactEmail,
        phone: contactPhone || undefined,
        content: contactContent,
      }
      console.log('body: ', body)
      const res = await fetch('/api/send-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok) {
        try {
          const j = JSON.parse(text)
          throw new Error(j.error || res.statusText)
        } catch (err) {
          if (err instanceof Error && err.message !== res.statusText) throw err
          const msg =
            text ||
            (res.status === 500
              ? 'Server error. If email is enabled, set GMAIL_USER and GMAIL_APP_PASSWORD on the API server.'
              : res.statusText)
          throw new Error(msg)
        }
      }
      const data = text ? JSON.parse(text) : {}
      if (data?.error) throw new Error(data.error)
      setContactSubmitted(true)
      setContactName('')
      setContactEmail('')
      setContactPhone('')
      setContactContent('')
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to send message. Please try again.')
    } finally {
      setContactLoading(false)
    }
  }

  // Custom Intersection Observer so scroll animations work in dev and production build
  useEffect(() => {
    document.body.setAttribute('data-aos-duration', String(AOS_DURATION))

    const container = containerRef.current
    if (!container) {
      return () => document.body.removeAttribute('data-aos-duration')
    }

    const elements = container.querySelectorAll<HTMLElement>('[data-aos]')
    const timeouts: ReturnType<typeof setTimeout>[] = []

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const el = entry.target as HTMLElement
          observer.unobserve(el)
          const delay = parseInt(el.getAttribute('data-aos-delay') ?? '0', 10)
          const animate = () => el.classList.add('aos-animate')
          if (delay > 0) {
            timeouts.push(setTimeout(animate, delay))
          } else {
            animate()
          }
        })
      },
      { rootMargin: `${AOS_OFFSET}px 0px`, threshold: 0 }
    )

    elements.forEach((el) => observer.observe(el))
    return () => {
      document.body.removeAttribute('data-aos-duration')
      elements.forEach((el) => observer.unobserve(el))
      timeouts.forEach((id) => clearTimeout(id))
    }
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY
      const scrollingDown = current > lastScrollY.current
      lastScrollY.current = current
      setShowScrollToTop(current > SCROLL_THRESHOLD_PX)
      setHeaderVisible(current <= SCROLL_THRESHOLD_PX || !scrollingDown)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div ref={containerRef} className="min-h-screen relative bg-white text-black">
        
        {/* Header - hides when scrolling down past 300px, shows when scrolling up or near top */}
        <header
          className={`fixed top-0 left-0 w-full min-h-[5rem] flex items-center justify-end shadow-xl px-4 sm:px-6 md:px-8 gap-2 sm:gap-4 z-50 bg-white transition-transform duration-500 ease-out ${
            headerVisible ? 'translate-y-0' : '-translate-y-full'
          }`}
        >
          <Link
            to="/login"
            className="px-4 sm:px-6 py-2 bg-gray-200 text-black font-medium hover:bg-gray-300 rounded-lg transition-colors text-sm sm:text-base"
          >
            Login to Matrix
          </Link>
          {/* <Link
            to="/signup"
            className="px-4 sm:px-6 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 rounded-lg transition-colors text-sm sm:text-base"
          >
            Sign Up
          </Link> */}
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 h-full pt-20 px-4 sm:px-6 md:px-8 text-center mt-10">
            {/* left side - AOS fade-up with stagger */}
            <div className="flex flex-col items-center justify-center gap-4 sm:gap-6 pt-6 sm:pt-10 w-full max-w-[90%] sm:max-w-[85%] lg:w-[76%] lg:max-w-none mx-auto pb-0">
                <img src='/AMBC logo update.png' alt="Logo" className="w-full max-h-36 sm:max-h-36 md:max-h-64 lg:h-120 object-contain" data-aos="fade-up" data-aos-delay="0" />
                <h1 className="-mt-10 text-2xl sm:text-3xl md:text-4xl font-semibold text-black max-w-[95%] sm:max-w-[80%] text-center" data-aos="fade-up" data-aos-delay="80">
                    Simplifying Healthcare<br />
                    Revenue Management.<br />
                    Strengthening Practice<br />
                    Performance.
                </h1>
                <p className="text-base sm:text-lg text-gray-600 font-normal max-w-[95%] sm:max-w-[80%] text-center mt-8 sm:mt-10" data-aos="fade-up" data-aos-delay="160">
                    End-to-end billing, coding, consulting, and<br />
                    proprietary technology designed to improve<br />
                    cash flow, reduce denials, and give practices complete financial visibility.
                </p>
                <a
                    href="#contact"
                    onClick={(e) => {
                        e.preventDefault()
                        document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })
                    }}
                    className='border w-[9rem] h-[3rem] bg-gray-900 text-white rounded-3xl hover:bg-white hover:text-black hover:border-black transition-colors inline-flex items-center justify-center'
                    data-aos="fade-up"
                    data-aos-delay="240"
                >
                    Get Started
                </a>
                <img className='w-full max-w-[90%] sm:max-w-[60%]' src='/Laptop.jpg' alt="Landing" data-aos="fade-up" data-aos-delay="320" />
            </div>
            {/* right side */}
            <div className="flex flex-col items-center justify-center gap-4 sm:gap-6 h-full min-h-0 overflow-hidden" data-aos="fade-left" data-aos-delay="200">
                <img src='/humen.jpg' alt="humen" className="w-full h-full min-h-[16rem] sm:min-h-[20rem] object-cover" />
            </div>
        </div>

        <div className='px-4 sm:px-6 md:px-8 lg:pl-[20%] lg:pr-[20%] w-full text-center text-black mt-12 sm:mt-16 md:mt-20 border-t border-black pt-8 sm:pt-10' data-aos="fade-up">
            <h1 className='text-2xl sm:text-3xl md:text-4xl font-semibold mb-4'>About Us</h1>
            <h2 className='text-xl sm:text-2xl font-medium mb-4'>Our Mission</h2>
            <p className='text-md sm:text-md'>
                American Medical Billing and Coding is dedicated to providing high-quality medical billing services to 
                healthcare professionals. We provide comprehensive revenue cycle solutions for healthcare practices that
                 want accuracy, transparency, and control over their financial operations. Our services combine expert billing 
                 and coding, strategic practice consulting, and proprietary software that tracks claims, payments, 
                and revenue in real time—so you can focus on patient care while we optimize your financial performance.
            </p>
        </div>

        <div className='w-[90%] mx-auto border-t border-black mt-12 sm:mt-16 mt-20' data-aos="fade-up" data-aos-delay="100">
            <img className='w-full' src='/display.png' alt="Display" />
        </div>

        <div className='w-full py-2 sm:py-10 md:py-12 px-6 sm:px-8 md:px-10'>
            <h1 className='text-2xl sm:text-3xl md:text-4xl font-semibold mb-6 sm:mb-8 md:mb-10 px-6 sm:px-8 md:px-10' data-aos="fade-up" data-aos-delay="0">Our Services</h1>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 md:gap-10 w-[95%] mx-auto'>
                <div className='flex flex-col items-start gap-2 text-left w-full min-w-0' data-aos="fade-up" data-aos-delay="0">
                    <div className='flex items-start justify-start '>
                        <h2 className='text-xl sm:text-2xl font-medium mb-0'>Medical Billing</h2>
                        <img src='/BillingTag.png' alt="Billing Tag" className="w-12 h-12 sm:w-16 sm:h-16 ml-2 flex-shrink-0 -mt-1" />
                    </div>
                    <p className='text-md'>
                        Accurate, compliant, and efficient billing is the foundation of sustainable revenue.
                    </p>

                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Insurance and patient billing management</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Certified medical coding and charge capture</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Claims submission, tracking, and follow-up</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Denial management and appeals</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Payment posting and reconciliation</span>
                    </p>
                    <p className='text-md flex items-start gap-2 text-left'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Compliance-focused processes aligned with payer and regulatory requirements</span>
                    </p>

                    <p className='text-md text-left mt-10'>
                        Faster reimbursements, fewer denials, and improved collections.
                    </p>
                    
                </div>

                <div className='flex flex-col gap-2 text-left items-start w-full min-w-0' data-aos="fade-up" data-aos-delay="150">
                    <div className='flex items-start justify-start '>
                        <h2 className='text-xl sm:text-2xl font-medium mb-0'>Proprietary Revenue Tracking Software</h2>
                        <img src='/Revenue.png' alt="Revenue Tracking Software" className="w-12 h-12 sm:w-16 sm:h-16 -ml-3 flex-shrink-0 -mt-1" />
                    </div>
                    <p className='text-md'>
                        Our proprietary platform delivers full visibility into your practice&apos;s financial health.
                    </p>
                    
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Claims status tracking</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Patient payment monitoring</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Revenue, adjustment, and aging analytics</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Centralized reporting and performance dashboards</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Data-driven insights to support faster decisions</span>
                    </p>

                    <p className='text-md text-left mt-10'>
                        Transparency, accountability, and actionable financial intelligence—without relying on fragmented systems.
                    </p>
                </div>

                <div className='flex flex-col items-start justify-start gap-2 text-left w-full min-w-0' data-aos="fade-up" data-aos-delay="300">
                    <div className='flex items-start justify-start '>
                        <h2 className='text-xl sm:text-2xl font-medium mb-0'>Practice Consultation</h2>
                        <img src='/consultation.png' alt="consultation" className="w-12 h-12 sm:w-16 sm:h-16 ml-2 flex-shrink-0 -mt-2" />
                    </div>
                    <p className='text-md'>
                        We help practices identify revenue gaps, operational inefficiencies, and growth opportunities.
                    </p>
                    
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Revenue cycle assessments and workflow optimization</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Financial performance analysis and benchmarking</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Payer mix and reimbursement strategy guidance</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Process improvement and staff training support</span>
                    </p>
                    <p className='text-md flex items-start gap-2'>
                        <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                        <span className="min-w-0">Scalable solutions for growing or transitioning practices</span>
                    </p>


                    <p className='text-md text-left mt-10'>
                        Stronger financial controls and smarter operational decisions.
                    </p>
                </div>
            </div>
        </div>

        <div className='w-full text-gray-900 border-b border-black pt-8 sm:pt-10 pb-8 sm:pb-10 px-4 sm:px-6' data-aos="fade-up">
            <h1 className='text-2xl sm:text-3xl md:text-4xl font-semibold mb-4 ml-0 sm:ml-8 md:ml-14'>Why Choose Us</h1>
            <div className='w-full max-w-[95%] sm:max-w-[85%] md:max-w-[70%] lg:w-[50%] mx-auto text-left pt-6 sm:pt-10'>
                
                <p className='text-base sm:text-lg md:text-xl flex items-start gap-2'>
                    <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                    <span className="min-w-0">Integrated approach: Services and technology working together</span>
                </p>
                <p className='text-base sm:text-lg md:text-xl flex items-start gap-2'>
                    <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                    <span className="min-w-0">Healthcare-focused expertise: Built specifically for medical practices</span>
                </p>
                <p className='text-base sm:text-lg md:text-xl flex items-start gap-2'>
                    <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                    <span className="min-w-0">Transparency: Clear reporting and measurable outcomes</span>
                </p>
                <p className='text-base sm:text-lg md:text-xl flex items-start gap-2'>
                    <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                    <span className="min-w-0">Scalability: Solutions that grow with your practice</span>
                </p>
                <p className='text-base sm:text-lg md:text-xl flex items-start gap-2'>
                    <span className="flex items-center shrink-0 h-[1.25em] mt-1"><Circle size={8} className="flex-shrink-0 bg-black rounded-full" /></span>
                    <span className="min-w-0">Results-driven: Designed to improve cash flow and reduce administrative burden</span>
                </p>
            </div>
        </div>

        <div id="contact" className='w-full text-gray-900 border-b border-black pt-8 sm:pt-10 pb-8 sm:pb-10 px-4 sm:px-6' data-aos="fade-up">
            <h1 className='text-2xl sm:text-3xl md:text-4xl font-semibold mb-6 sm:mb-8 ml-0 sm:ml-8 md:ml-14'>Contact Us</h1>
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-8 sm:gap-10 mt-6 sm:mt-10 w-full max-w-[95%] sm:max-w-[95%] mx-auto  lg:px-10'>
                {/* left - Get in Touch text */}
                <div className='ml-0 sm:ml-10 md:ml-20 lg:ml-0'>
                    <h3 className='text-lg sm:text-xl text-gray-700 pb-4 sm:pb-6'>Get in Touch</h3>
                    <p className='text-md sm:text-md text-gray-600'>
                        Reach out to us today to elevate your practice's financial
                        performance with our cutting-edge medical billing solutions. Let's work together to
                        streamline your revenue cycle and optimize your practice's profitability.
                    </p>
                </div>
                {/* right - Contact form */}
                <div className='w-full max-w-md lg:max-w-none'>
                    {contactSubmitted ? (
                        <div className='p-6 rounded-lg border border-gray-300 bg-gray-50 text-gray-800'>
                            <p className='font-medium text-lg'>Thank you for reaching out.</p>
                            <p className='text-sm mt-2'>We will get back to you as soon as possible.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleContactSubmit} className='flex flex-col gap-4'>
                            {contactError && (
                                <div className='p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm'>
                                    {contactError}
                                </div>
                            )}
                            <div>
                                <label htmlFor='contact-name' className='block text-sm font-medium text-gray-700 mb-1'>Name</label>
                                <input
                                    id='contact-name'
                                    type='text'
                                    value={contactName}
                                    onChange={(e) => setContactName(e.target.value)}
                                    required
                                    className='w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 outline-none transition'
                                    placeholder='Your name'
                                />
                            </div>
                            <div>
                                <label htmlFor='contact-email' className='block text-sm font-medium text-gray-700 mb-1'>Email</label>
                                <input
                                    id='contact-email'
                                    type='email'
                                    value={contactEmail}
                                    onChange={(e) => setContactEmail(e.target.value)}
                                    required
                                    className='w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 outline-none transition'
                                    placeholder='your@email.com'
                                />
                            </div>
                            <div>
                                <label htmlFor='contact-phone' className='block text-sm font-medium text-gray-700 mb-1'>Phone Number</label>
                                <input
                                    id='contact-phone'
                                    type='tel'
                                    value={contactPhone}
                                    onChange={(e) => setContactPhone(e.target.value)}
                                    required
                                    className='w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 outline-none transition'
                                    placeholder='(555) 123-4567'
                                />
                            </div>
                            <div>
                                <label htmlFor='contact-content' className='block text-sm font-medium text-gray-700 mb-1'>Message</label>
                                <textarea
                                    id='contact-content'
                                    value={contactContent}
                                    onChange={(e) => setContactContent(e.target.value)}
                                    required
                                    rows={4}
                                    className='w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 outline-none transition resize-y min-h-[100px]'
                                    placeholder='How can we help you?'
                                />
                            </div>
                            <button
                                type='submit'
                                disabled={contactLoading}
                                className='mt-2 px-6 py-3 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 transition disabled:opacity-60 disabled:cursor-not-allowed'
                            >
                                {contactLoading ? 'Sending…' : 'Send Message'}
                            </button>
                        </form>
                    )}
                </div>
                <div className='w-full max-w-md lg:max-w-none'></div>
            </div>
        </div>

        <div className='pt-8 sm:pt-10 px-4' data-aos="fade-up">
            <img src='/AMBC logo update.png' alt='' className='w-full max-w-[400px] sm:max-w-[440px] md:w-140 h-36 sm:h-48 md:h-64 mx-auto object-contain -mt-20' />
            <p className='text-base sm:text-lg md:text-xl text-blue-600 text-center -mt-10'>Call/Text: <span className='font-bold'>725-346-5009</span></p>
            <p className='text-base sm:text-lg md:text-xl text-blue-600 text-center mt-1 pb-12 sm:pb-20'>office@amerbilling.com</p>
        </div>

        {/* Scroll to top - visible when scrolled more than 300px */}
        {showScrollToTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-gray-900 text-white hover:bg-white hover:text-black border-2 border-gray-900 shadow-lg transition-all duration-500 hover:scale-110"
            aria-label="Scroll to top"
          >
            <ArrowUp className="w-6 h-6" />
          </button>
        )}
    </div>
  )
}