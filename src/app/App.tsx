import { Shell } from "./Shell";
import { StoreProvider } from "./store";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
