"use client";

import { motion } from "framer-motion";
import { Icon } from "@iconify/react";

export default function Home() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#02040a] overflow-hidden relative">
            {/* Minimal Dark Background */}
            <div className="absolute inset-0 z-0 opacity-[0.05] pointer-events-none"
                style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
            
            <div className="z-10 text-center space-y-6">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 1 }}
                    className="relative"
                >
                    <div className="absolute -inset-8 bg-blue-600/10 rounded-full blur-3xl" />
                    <Icon icon="ph:flask-bold" className="text-7xl text-blue-500/40 relative" />
                </motion.div>

                <div className="space-y-2">
                    <h1 className="text-2xl font-black tracking-[0.3em] text-white/20 uppercase">
                        UF <span className="text-blue-500/30">CHEMIST</span>
                    </h1>
                    <div className="flex items-center justify-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                            Laboratory Node: Standby
                        </span>
                    </div>
                </div>
                
                <p className="text-[11px] text-slate-600 max-w-xs mx-auto leading-relaxed">
                    Widget service is active and ready for export. Open the "Ask The Chemist" portal in the corner to verify the connection.
                </p>
            </div>
        </main>
    );
}
