import React, { createContext, useContext, useRef, useState } from 'react';

const ProcessingContext = createContext({ message: null, show: () => {}, hide: () => {} });

export function ProcessingProvider({ children }) {
  const [message, setMessage] = useState(null);
  // Counter so concurrent mutations don't clear each other's toast prematurely
  const countRef = useRef(0);

  const show = (msg) => {
    countRef.current += 1;
    setMessage(msg);
  };

  const hide = () => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) setMessage(null);
  };

  return (
    <ProcessingContext.Provider value={{ message, show, hide }}>
      {children}
    </ProcessingContext.Provider>
  );
}

export function useProcessingCtx() {
  return useContext(ProcessingContext);
}
