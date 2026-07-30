import { motion, AnimatePresence } from 'framer-motion';
import { SteamVotingDashboard } from './components/SteamVotingDashboard';
import './App.css';

function App() {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="app-main-view"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: '100%', minHeight: '100vh' }}
      >
        <SteamVotingDashboard />
      </motion.div>
    </AnimatePresence>
  );
}

export default App;
