import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import safespeakLogo from '@/assets/safespeak-logo-new.png';

const Navbar = () => {
  return (
    <nav className="sticky top-0 z-50 border-b bg-gradient-to-r from-primary/10 via-secondary/5 to-accent/10 backdrop-blur-lg">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={safespeakLogo} alt="SafeSpeak" className="h-16 w-auto object-contain" />
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link to="/" className="text-foreground/80 hover:text-foreground transition-colors">
            Home
          </Link>
          <Link to="/about" className="text-foreground/80 hover:text-foreground transition-colors">
            About
          </Link>
          <Link to="/privacy" className="text-foreground/80 hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link to="/report">
            <Button variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1.5">
              📞 Voice Booth
            </Button>
          </Link>
          <Link to="/report">
            <Button>Report</Button>
          </Link>
        </div>

        <div className="md:hidden flex items-center gap-2">
          <Link to="/report">
            <Button size="sm" variant="outline" className="border-emerald-500/30 text-emerald-600">📞 Booth</Button>
          </Link>
          <Link to="/report">
            <Button size="sm">Report</Button>
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
