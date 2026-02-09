'use client';

import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@iconify/react';

import ReactMarkdown from 'react-markdown';

export default function ChatWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; timestamp: string }[]>([
        {
            role: 'assistant',
            content: "I am Dr. Aris. I'm here to help you get clear, safe answers about our products—and I'll slow things down if details really matter.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen) {
            scrollToBottom();
        }
    }, [messages, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp }]);
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: userMessage,
                    history: messages.map(m => ({ role: m.role, content: m.content })),
                }),
            });

            const data = await response.json();

            if (data.error) {
                // Pass the code/details if strictly needed, or just throw the message
                const err: any = new Error(data.error);
                err.code = data.code;
                throw err;
            }

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.response,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
        } catch (error: any) {
            console.error('Chat error:', error);

            let errorMessage = "Oops! Something went wrong on my end. Let's try that again.";
            if (error.code === 'RATE_LIMITED') {
                errorMessage = "You're sending messages too quickly. Please wait a moment before trying again.";
            } else if (error.code === 'VALIDATION_ERROR') {
                errorMessage = "Your message is too long or invalid. Please try a shorter question.";
            } else if (error.code === 'CONFIGURATION_ERROR') {
                errorMessage = "I'm currently undergoing maintenance. Please check back shortly.";
            }

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: errorMessage,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const clearChat = () => {
        setMessages([
            {
                role: 'assistant',
                content: "I am Dr. Aris. I'm here to help you get clear, safe answers about our products—and I'll slow things down if details really matter.",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        ]);
    };

    return (
        <>
            {/* Floating Toggle Button */}
            <div className="fixed bottom-6 right-6 z-50 flex items-center">
                <AnimatePresence>
                    {!isOpen && (
                        <motion.div
                            initial={{ opacity: 0, x: 20, scale: 0.8 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 10, scale: 0.8 }}
                            className="mr-3 cursor-pointer"
                            onClick={() => setIsOpen(true)}
                        >
                            <motion.div
                                animate={{
                                    x: [0, -4, 0],
                                }}
                                transition={{
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                }}
                                className="relative group"
                            >
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600/50 to-cyan-600/50 rounded-full blur opacity-40 group-hover:opacity-100 transition duration-1000" />
                                <div className="relative px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-full flex items-center gap-3 shadow-2xl">
                                    <span className="text-[10px] font-black tracking-[0.2em] text-white uppercase whitespace-nowrap">
                                        Product & Safety Info
                                    </span>
                                    <div className="flex space-x-1">
                                        <div className="w-1 h-1 rounded-full bg-blue-400 animate-ping" />
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="relative flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xl transition-all hover:scale-110 active:scale-95 group overflow-hidden border border-slate-700"
                    aria-label="Open Chemical Safety Intelligence"
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-[#0052cc]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    {isOpen ? (
                        <Icon icon="ph:x-bold" className="relative z-10 h-7 w-7 text-white" />
                    ) : (
                        <Icon icon="ph:flask-bold" className="relative z-10 h-8 w-8 text-white" />
                    )}
                </button>
            </div>

            {/* Chat Window */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed bottom-24 right-6 z-50 flex h-[min(900px,88vh)] w-[min(650px,95vw)] flex-col overflow-hidden rounded-[40px] border border-white/20 bg-white/95 backdrop-blur-xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)]"
                    >
                        {/* Header: Dr. Aris Laboratory UI */}
                        <div className="relative h-44 w-full overflow-hidden">
                            {/* Background Image with Blur and Overlay */}
                            <img
                                src="/dr_aris_bg.png"
                                alt="Laboratory"
                                className="absolute inset-0 h-full w-full object-cover scale-110 blur-[1px]"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/60 to-slate-900/40" />

                            {/* Header Content */}
                            <div className="relative h-full w-full flex flex-col p-6 z-10">
                                {/* Top Toolbar */}
                                <div className="flex justify-between items-start mb-auto">
                                    <button
                                        onClick={clearChat}
                                        className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 transition-colors"
                                    >
                                        <Icon icon="ph:trash-bold" className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsOpen(false)}
                                        className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 transition-colors"
                                    >
                                        <Icon icon="ph:x-bold" className="h-5 w-5" />
                                    </button>
                                </div>

                                {/* Main Title Area */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                                        <span className="text-[10px] font-black tracking-[0.2em] text-white/70 uppercase">
                                            Laboratory Secure Uplink
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-slate-100/10 text-white/50 border border-white/10 ml-1">
                                            1K RES
                                        </span>
                                    </div>
                                    <h2 className="text-3xl font-bold text-white tracking-tight">Dr. Aris</h2>
                                    <p className="text-[10px] font-medium tracking-[0.1em] text-white/60 uppercase">
                                        Chemical Safety Intelligence
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar relative">
                            {/* Side Grid Pattern (subtle) */}
                            <div className="absolute right-0 top-0 bottom-0 w-24 opacity-[0.03] pointer-events-none overflow-hidden">
                                <div className="h-full w-full bg-[linear-gradient(to_right,#000_1px,transparent_1px)] bg-[size:20px_100%]" />
                            </div>

                            <div className="flex flex-col space-y-6 relative z-10">
                                {messages.map((msg, index) => (
                                    <div
                                        key={index}
                                        className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                                    >
                                        <div
                                            className={`max-w-[85%] rounded-[24px] px-6 py-4 text-[15px] leading-relaxed relative prose prose-slate ${msg.role === 'user'
                                                ? 'bg-blue-600 text-white rounded-br-none shadow-[0_10px_30px_-10px_rgba(37,99,235,0.4)] prose-invert'
                                                : 'bg-white text-slate-700 border border-slate-100 rounded-bl-none shadow-sm'
                                                }`}
                                        >
                                            <ReactMarkdown
                                                components={{
                                                    a: ({ node, ...props }) => (
                                                        <a
                                                            {...props}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-800 underline font-bold decoration-blue-500/30 underline-offset-4"
                                                        />
                                                    ),
                                                }}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                        <span className="text-[10px] font-medium text-slate-400 mt-2 px-1 uppercase tracking-wider">
                                            {msg.timestamp}
                                        </span>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex flex-col items-start">
                                        <div className="bg-white border border-slate-100 rounded-[24px] rounded-bl-none px-6 py-4 shadow-sm">
                                            <div className="flex space-x-1.5 pt-1">
                                                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]"></div>
                                                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]"></div>
                                                <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300"></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Input Area */}
                        <div className="p-6 pb-6 bg-white">
                            <form onSubmit={handleSubmit} className="relative group mb-4">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Ask me anything about our products..."
                                    className="w-full h-14 pl-6 pr-14 rounded-2xl border-none bg-slate-50 text-slate-900 placeholder:text-slate-400 text-sm focus:ring-2 focus:ring-slate-900/5 transition-all"
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="absolute right-2 top-2 h-10 w-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 transition-colors disabled:opacity-30"
                                >
                                    <Icon icon="ph:triangle-bold" className="h-5 w-5 rotate-90" />
                                </button>
                            </form>

                            {/* Security Footer */}
                            <div className="flex flex-col items-center justify-center gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black tracking-[0.2em] text-slate-300 uppercase">
                                        ISO-27001 Data Vault
                                    </span>
                                    <div className="h-1 w-1 rounded-full bg-slate-200" />
                                    <span className="text-[9px] font-black tracking-[0.2em] text-slate-300 uppercase">
                                        Quantum SSL V3
                                    </span>
                                </div>
                                <p className="text-[9px] text-slate-400 font-medium text-center px-4 leading-tight">
                                    AI-generated for informational use. The product label and SDS are the final authorities on safety and usage. Always verify with our team before proceeding.
                                </p>
                            </div>
                        </div>

                        <style jsx>{`
                            .custom-scrollbar::-webkit-scrollbar {
                                width: 4px;
                            }
                            .custom-scrollbar::-webkit-scrollbar-track {
                                background: transparent;
                            }
                            .custom-scrollbar::-webkit-scrollbar-thumb {
                                background: #e2e8f0;
                                border-radius: 10px;
                            }
                            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                                background: #cbd5e1;
                            }
                        `}</style>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
