import { ApiQuickStartSection } from "@/components/landing/api-quick-start-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { Footer } from "@/components/landing/footer";
import { HeroSection } from "@/components/landing/hero-section";
import { Navbar } from "@/components/landing/navbar";
import { ProvidersSection } from "@/components/landing/providers-section";

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <ApiQuickStartSection />
        <ProvidersSection />
      </main>
      <Footer />
    </div>
  );
}
