import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/Overview";
import AllActions from "@/pages/AllActions";
import ActionDetail from "@/pages/ActionDetail";
import Roadmap from "@/pages/Roadmap";
import TrainingWorkbench from "@/pages/TrainingWorkbench";
import Evals from "@/pages/Evals";
import Issues from "@/pages/Issues";
import ExecutiveBrief from "@/pages/ExecutiveBrief";
import MoneyPath from "@/pages/MoneyPath";
import HitlBurden from "@/pages/HitlBurden";
import DataPipeline from "@/pages/DataPipeline";
import Explorer from "@/pages/Explorer";
import Backlog from "@/pages/Backlog";
import Run from "@/pages/Run";
import Fleet from "@/pages/Fleet";
import Autonomy from "@/pages/Autonomy";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/exec" component={ExecutiveBrief} />
      <Route path="/explorer" component={Explorer} />
      <Route path="/backlog" component={Backlog} />
      <Route path="/run" component={Run} />
      <Route path="/fleet" component={Fleet} />
      <Route path="/autonomy" component={Autonomy} />
      <Route path="/actions" component={AllActions} />
      <Route path="/actions/:name" component={ActionDetail} />
      <Route path="/roadmap" component={Roadmap} />
      <Route path="/training" component={TrainingWorkbench} />
      <Route path="/pipeline" component={DataPipeline} />
      <Route path="/evals" component={Evals} />
      <Route path="/hitl" component={HitlBurden} />
      <Route path="/money-path" component={MoneyPath} />
      <Route path="/issues" component={Issues} />
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
