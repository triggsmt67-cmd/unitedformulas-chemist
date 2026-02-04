"use client";

import { motion } from "framer-motion";
import { Icon } from "@iconify/react";

export default function Home() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#0a0a0a] overflow-hidden relative">
            {/* Background decoration */}
            <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900 rounded-full blur-[120px]" />
            </div>

            <div className="z-10 max-w-4xl w-full text-center space-y-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-panel text-blue-400 text-sm font-medium mb-4"
                >
                    <Icon icon="mdi:flask-outline" className="text-lg" />
                    <span>Industrial Formulation Protocol v3.0</span>
                </motion.div>

                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    className="text-6xl md:text-8xl font-black tracking-tighter glow-text"
                >
                    UF <span className="text-blue-500">CHEMIST</span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto font-light leading-relaxed"
                >
                    An autonomous chemical intelligence suite designed for
                    <span className="text-white font-medium"> United Formulas</span>.
                    Advanced RAG-driven synthesis and formulation analysis.
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.6 }}
                    className="flex flex-wrap items-center justify-center gap-4 pt-8"
                >
                    <button className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all transform hover:scale-105 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                        Initialize Analysis
                    </button>
                    <button className="px-8 py-4 glass-panel hover:bg-white/5 text-white font-bold rounded-lg transition-all">
                        View Protocol
                    </button>
                </motion.div>
            </div>

            {/* Experimental Grid Overlay */}
            <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
                style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        </main>
    );
}
