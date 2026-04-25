import { useState } from 'react'
import { MessageCircle, Send, Search, User, Paperclip } from 'lucide-react'

// Sample users (UI only – not connected to real data)
const SAMPLE_USERS = [
  { id: '1', name: 'Sarah Chen', role: 'Billing Staff', email: 'sarah.chen@example.com', lastSeen: '2m ago' },
  { id: '2', name: 'Mike Johnson', role: 'Office Staff', email: 'mike.j@example.com', lastSeen: '5m ago' },
  { id: '3', name: 'Admin Support', role: 'Admin', email: 'admin@example.com', lastSeen: '1h ago' },
  { id: '4', name: 'Emily Davis', role: 'Provider', email: 'emily.d@example.com', lastSeen: 'Yesterday' },
  { id: '5', name: 'James Wilson', role: 'Billing Staff', email: 'james.w@example.com', lastSeen: '2d ago' },
]

// Sample messages per conversation (UI only)
const SAMPLE_CONVERSATIONS: Record<string, { from: string; text: string; time: string; isMe: boolean }[]> = {
  '1': [
    { from: 'Sarah Chen', text: 'Hi! Can you confirm the March billing codes for Valley Clinic?', time: '10:02 AM', isMe: false },
    { from: 'You', text: 'Yes, I’ll double-check and send the list by end of day.', time: '10:05 AM', isMe: true },
    { from: 'Sarah Chen', text: 'Thanks, that would be great.', time: '10:06 AM', isMe: false },
  ],
  '2': [
    { from: 'Mike Johnson', text: 'Patient intake forms for this week are ready for review.', time: '9:45 AM', isMe: false },
    { from: 'You', text: 'I’ll take a look this afternoon.', time: '9:52 AM', isMe: true },
  ],
  '3': [
    { from: 'Admin Support', text: 'Reminder: system maintenance is scheduled for Sunday 2–4 AM.', time: 'Yesterday', isMe: false },
    { from: 'You', text: 'Noted, thanks for the heads up.', time: 'Yesterday', isMe: true },
  ],
  '4': [
    { from: 'Emily Davis', text: 'Could we add the new CPT code 99214 to my template?', time: 'Mon', isMe: false },
    { from: 'You', text: 'Sure, I’ll add it and let you know when it’s live.', time: 'Mon', isMe: true },
  ],
  '5': [
    { from: 'James Wilson', text: 'Q1 reports are ready. When do you want to go through them?', time: 'Last week', isMe: false },
  ],
}

export default function Messages() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(SAMPLE_USERS[0].id)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredUsers = SAMPLE_USERS.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const selectedUser = SAMPLE_USERS.find((u) => u.id === selectedUserId)
  const messages = selectedUserId ? SAMPLE_CONVERSATIONS[selectedUserId] ?? [] : []

  const getInitials = (name: string) => {
    if (name === 'You') return 'Me'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white flex items-center gap-2">
          <MessageCircle size={32} />
          Messages
        </h1>
        <p className="text-white/70 mt-1">Sample messaging UI — not connected to live data.</p>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 rounded-xl overflow-hidden border border-white/20 bg-white/5 backdrop-blur-md">
        {/* Left: user list */}
        <div className="w-80 flex-shrink-0 flex flex-col border-r border-white/10 bg-white/5">
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" size={18} />
              <input
                type="text"
                placeholder="Search people..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <div className="p-4 text-center text-white/50 text-sm">No users match your search.</div>
            ) : (
              filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    selectedUserId === user.id
                      ? 'bg-primary-600/30 text-white border-l-2 border-primary-400'
                      : 'hover:bg-white/10 text-white/90'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <User size={20} className="text-white/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{user.name}</div>
                    <div className="text-xs text-white/60 truncate">{user.role} · {user.lastSeen}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedUser ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/5">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <User size={20} className="text-white/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white">{selectedUser.name}</div>
                  <div className="text-xs text-white/60">{selectedUser.role} · {selectedUser.email}</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`relative flex items-end gap-2 ${msg.isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    {!msg.isMe && (

                      <div
                        className={`absolute top-2 left-0 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
                          msg.isMe
                            ? 'bg-primary-500 text-white'
                            : 'bg-white/25 text-white border border-white/30'
                        }`}
                        title={msg.from}
                      >
                        {getInitials(msg.from)}
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] rounded-lg px-4 py-2 ${
                        msg.isMe
                          ? 'bg-primary-600 text-white mr-10'
                          : 'bg-white/15 text-white border border-white/20 ml-10'
                      }`}
                    >
                      {!msg.isMe && (
                        <div className="text-xs font-medium text-white/80 mb-1">{msg.from}</div>
                      )}
                      <div className="text-sm">{msg.text}</div>
                      <div className={`text-xs mt-1 ${msg.isMe ? 'text-white/80' : 'text-white/60'}`}>
                        {msg.time}
                      </div>
                    </div>
                    {msg.isMe && (
                      <div
                        className="absolute top-2 right-0 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium bg-primary-500 text-white"
                        title={msg.from}
                      >
                        {getInitials(msg.from)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Compose area (UI only – does nothing) */}
              <div className="p-4 border-t border-white/10 bg-white/5">
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    disabled
                    className="p-3 rounded-lg bg-white/10 border border-white/20 text-white/60 cursor-not-allowed hover:bg-white/15 transition-colors"
                    title="Upload file (not implemented yet)"
                  >
                    <Paperclip size={20} />
                  </button>
                  <input
                    type="text"
                    placeholder="Type a message… "
                    readOnly
                    className="flex-1 px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled
                    className="px-4 py-3 rounded-lg bg-white/20 text-white/60 cursor-not-allowed flex items-center gap-2"
                    title="Messaging not implemented yet"
                  >
                    <Send size={18} />
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/50">
              <div className="text-center">
                <MessageCircle size={48} className="mx-auto mb-2 opacity-50" />
                <p>Select a conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
