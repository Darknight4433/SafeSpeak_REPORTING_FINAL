import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Shield, Lock, CheckCircle, PhoneCall } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [countdown, setCountdown] = useState<number>(10);

  useEffect(() => {
    // Unconditionally redirect to /report after 10 seconds
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Preserve query parameters or ws query when redirecting
          const rawSearch = window.location.search || (window.location.hash.includes('?') ? '?' + window.location.hash.split('?')[1] : '');
          window.location.hash = `#/report${rawSearch}`;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-secondary/5 to-accent/10 py-16 px-4">
          <div className="container max-w-6xl mx-auto text-center relative z-10">
            {/* 10-Second Kiosk Countdown Banner */}
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full border border-primary/30 bg-primary/10 mb-6 shadow-sm animate-pulse">
              <PhoneCall className="h-4 w-4 text-primary animate-bounce" />
              <span className="text-sm font-semibold text-primary">
                Opening SafeSpeak Phone Booth in {countdown}s...
              </span>
              <Link to="/report">
                <Button size="sm" variant="default" className="h-7 text-xs px-3">
                  Open Now
                </Button>
              </Link>
            </div>

            <h1 className="text-5xl md:text-6xl font-bold mb-6 animate-slideUp">
              <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                Your Voice Matters
              </span>
              <br />
              <span className="text-foreground">We're Here to Listen</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-slideUp delay-100">
              A safe space for you to share your concerns. We're here to help and protect you.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12 animate-slideUp delay-200">
              <Link to="/report">
                <Button size="lg" className="shadow-glow">
                  Submit a Report
                </Button>
              </Link>
              <Link to="/about">
                <Button size="lg" variant="outline">
                  Learn How It Works
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <Card className="border-primary/20 animate-bounceIn">
                <CardContent className="pt-6 text-center">
                  <Lock className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Anonymous</h3>
                  <p className="text-sm text-muted-foreground">
                    Your identity stays protected
                  </p>
                </CardContent>
              </Card>

              <Card className="border-secondary/20 animate-bounceIn delay-100">
                <CardContent className="pt-6 text-center">
                  <CheckCircle className="h-12 w-12 text-secondary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Verified Authorities</h3>
                  <p className="text-sm text-muted-foreground">
                    Only trained professionals see reports
                  </p>
                </CardContent>
              </Card>

              <Card className="border-accent/20 animate-bounceIn delay-200">
                <CardContent className="pt-6 text-center">
                  <Shield className="h-12 w-12 text-accent mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Immediate Action</h3>
                  <p className="text-sm text-muted-foreground">
                    Your concerns are addressed quickly
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="absolute top-20 left-10 w-64 h-64 bg-primary/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 right-10 w-80 h-80 bg-secondary/20 rounded-full blur-3xl animate-pulse delay-100" />
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
