import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BtcToZmwPage } from '../pages/BtcToZmwPage';
import { ZmwToBtcPage } from '../pages/ZmwToBtcPage';

interface CurrencyModeContainerProps {
  initialMode: 'btc-to-zmw' | 'zmw-to-btc';
}

export function CurrencyModeContainer({ initialMode }: CurrencyModeContainerProps) {
  const [currentMode, setCurrentMode] = useState<'btc-to-zmw' | 'zmw-to-btc'>(initialMode);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const isDragging = useRef<boolean>(false);
  const scrollStartX = useRef<number>(0);

  // Update current mode when route changes
  useEffect(() => {
    const newMode = location.pathname === '/btc-to-zmw' ? 'btc-to-zmw' : 'zmw-to-btc';
    if (newMode !== currentMode) {
      setCurrentMode(newMode);
    }
  }, [location.pathname, currentMode]);

  const switchMode = (newMode: 'btc-to-zmw' | 'zmw-to-btc') => {
    if (newMode === currentMode || isTransitioning) return;
    
    setIsTransitioning(true);
    setCurrentMode(newMode);
    
    // Update URL
    navigate(newMode === 'btc-to-zmw' ? '/btc-to-zmw' : '/zmw-to-btc', { replace: true });
    
    // Reset transition state after animation
    setTimeout(() => {
      setIsTransitioning(false);
    }, 300);
  };

  // Touch event handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    isDragging.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) {
      isDragging.current = true;
    }
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    
    const deltaX = touchStartX.current - touchEndX.current;
    const threshold = 50; // Minimum swipe distance
    
    if (Math.abs(deltaX) > threshold) {
      if (deltaX > 0) {
        // Swiped left - go to next mode
        const nextMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
        switchMode(nextMode);
      } else {
        // Swiped right - go to previous mode
        const prevMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
        switchMode(prevMode);
      }
    }
    
    isDragging.current = false;
  };

  // Mouse/wheel event handlers for desktop
  const handleWheel = (e: React.WheelEvent) => {
    // Only handle horizontal scroll or when shift is held
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      
      const threshold = 50;
      if (Math.abs(e.deltaX) > threshold || (e.shiftKey && Math.abs(e.deltaY) > threshold)) {
        const delta = e.deltaX || (e.shiftKey ? e.deltaY : 0);
        
        if (delta > 0) {
          // Scroll right - go to next mode
          const nextMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
          switchMode(nextMode);
        } else {
          // Scroll left - go to previous mode
          const prevMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
          switchMode(prevMode);
        }
      }
    }
  };

  // Mouse drag handlers for desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    scrollStartX.current = e.clientX;
    isDragging.current = false;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) {
        isDragging.current = true;
      }
    };
    
    const handleMouseUp = (upEvent: MouseEvent) => {
      if (isDragging.current) {
        const deltaX = scrollStartX.current - upEvent.clientX;
        const threshold = 100; // Larger threshold for mouse drag
        
        if (Math.abs(deltaX) > threshold) {
          if (deltaX > 0) {
            // Dragged left - go to next mode
            const nextMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
            switchMode(nextMode);
          } else {
            // Dragged right - go to previous mode
            const prevMode = currentMode === 'btc-to-zmw' ? 'zmw-to-btc' : 'btc-to-zmw';
            switchMode(prevMode);
          }
        }
      }
      
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="relative w-full">
      {/* Mode indicator dots */}
      <div className="flex justify-center mb-6">
        <div className="flex space-x-2">
          <button
            onClick={() => switchMode('btc-to-zmw')}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              currentMode === 'btc-to-zmw' 
                ? 'bg-orange-500 scale-110' 
                : 'bg-gray-300 hover:bg-gray-400'
            }`}
            aria-label="Bitcoin to Kwacha mode"
          />
          <button
            onClick={() => switchMode('zmw-to-btc')}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              currentMode === 'zmw-to-btc' 
                ? 'bg-orange-500 scale-110' 
                : 'bg-gray-300 hover:bg-gray-400'
            }`}
            aria-label="Kwacha to Bitcoin mode"
          />
        </div>
      </div>

      {/* Swipe hint */}
      <div className="text-center mb-4">
        <p className="text-sm text-gray-500">
          <span className="hidden md:inline">Scroll horizontally or drag to switch modes</span>
          <span className="md:hidden">Swipe left or right to switch modes</span>
        </p>
      </div>

      {/* Content container with gesture handlers */}
      <div
        ref={containerRef}
        className={`relative overflow-hidden transition-all duration-300 ${
          isTransitioning ? 'pointer-events-none' : ''
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ 
          cursor: isDragging.current ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'pan-y' // Allow vertical scrolling but handle horizontal
        }}
      >
        {/* Content wrapper with slide animation */}
        <div
          className={`flex transition-transform duration-300 ease-in-out ${
            isTransitioning ? 'transform' : ''
          }`}
          style={{
            transform: currentMode === 'btc-to-zmw' ? 'translateX(0%)' : 'translateX(-100%)',
            width: '200%'
          }}
        >
          {/* BTC to ZMW Page */}
          <div className="w-1/2 flex-shrink-0">
            <div className={`transition-opacity duration-300 ${
              currentMode === 'btc-to-zmw' ? 'opacity-100' : 'opacity-50'
            }`}>
              <BtcToZmwPage />
            </div>
          </div>

          {/* ZMW to BTC Page */}
          <div className="w-1/2 flex-shrink-0">
            <div className={`transition-opacity duration-300 ${
              currentMode === 'zmw-to-btc' ? 'opacity-100' : 'opacity-50'
            }`}>
              <ZmwToBtcPage />
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard navigation hint */}
      <div className="text-center mt-6">
        <p className="text-xs text-gray-400">
          <span className="hidden md:inline">Hold Shift + scroll vertically to switch modes</span>
        </p>
      </div>
    </div>
  );
}
