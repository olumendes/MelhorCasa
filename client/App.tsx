import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Dislikes from "./pages/Dislikes";
import Cofrinho from "./pages/Cofrinho";
import CasasComTags from "./pages/CasasComTags";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
                                <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/dislikes" element={<Dislikes />} />
          <Route path="/cofrinho" element={<Cofrinho />} />
          <Route path="/casas-com-tags" element={<CasasComTags />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
