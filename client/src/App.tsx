import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/Overview";
import Roadmap from "@/pages/Roadmap";
import AbRuns from "@/pages/AbRuns";
import ScriptSage from "@/pages/ScriptSage";
import PipelineHealth from "@/pages/PipelineHealth";
import DataPipeline from "@/pages/DataPipeline";
import Issues from "@/pages/Issues";
import ExecutiveBrief from "@/pages/ExecutiveBrief";
import VeoCost from "@/pages/VeoCost";
import Subscriptions from "@/pages/Subscriptions";
import Explorer from "@/pages/Explorer";
import Backlog from "@/pages/Backlog";
import Run from "@/pages/Run";
import Fleet from "@/pages/Fleet";
import Themes from "@/pages/Themes";
import Scoring from "@/pages/Scoring";
import ThemeDetail from "@/pages/ThemeDetail";
import Bandit from "@/pages/Bandit";
import HitlBurden from "@/pages/HitlBurden";
import DataTableDemo from "@/pages/dev/DataTableDemo";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/exec" component={ExecutiveBrief} />
      <Route path="/explorer" component={Explorer} />
      <Route path="/backlog" component={Backlog} />
      <Route path="/run" component={Run} />
      <Route path="/fleet" component={Fleet} />
      <Route path="/themes" component={Themes} />
      <Route path="/themes/:slug" component={ThemeDetail} />
      <Route path="/ab-runs" component={AbRuns} />
      <Route path="/scoring" component={Scoring} />
      <Route path="/bandit" component={Bandit} />
      <Route path="/hitl" component={HitlBurden} />
      <Route path="/scriptsage" component={ScriptSage} />
      <Route path="/pipeline-health" component={PipelineHealth} />
      <Route path="/pipeline" component={DataPipeline} />
      <Route path="/veo-cost" component={VeoCost} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/roadmap" component={Roadmap} />
      <Route path="/issues" component={Issues} />
      {/* FUTURE: DNA action library — `/actions`, `/actions/:name`, and `/autonomy` */}
      {/* are intentionally unmapped so they 404 until a DNA-domain action surface */}
      {/* is designed (knob configs, engine catalog, post-proc stages, etc.). */}
      {/* SID-era routes — redirect to home so old bookmarks don't 404. */}
      <Route path="/training"><Redirect to="/scriptsage" /></Route>
      <Route path="/evals"><Redirect to="/ab-runs" /></Route>
      <Route path="/money-path"><Redirect to="/veo-cost" /></Route>
      {/* Hidden dev routes (not in sidebar). */}
      <Route path="/_dev/datatable" component={DataTableDemo} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
