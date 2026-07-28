import { Route, Switch } from "wouter";
import AccessGate from "./components/AccessGate";
import Dispatch from "./pages/Dispatch";
import DriverView from "./pages/DriverView";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <AccessGate>
          <Dispatch />
        </AccessGate>
      </Route>
      <Route path="/driver/:token" component={DriverView} />
      <Route component={NotFound} />
    </Switch>
  );
}
