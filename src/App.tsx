/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Settings, Download, X } from 'lucide-react';

type GiftType = 'tote' | 'acc' | 'water' | 'none';

interface InventoryItem {
  name: string;
  count: number;
  img: string;
  icon: string;
}

interface LogEntry {
  timestamp: string;
  result: string;
  type: string;
}

export default function App() {
  const [inventory, setInventory] = useState<Record<GiftType, InventoryItem>>({
    tote: { name: "Túi tote Samsung", count: 50, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774072448/Gemini_Generated_Image_7ab5q07ab5q07ab5_lcrwcz.png', },
    acc: { name: "Túi phụ kiện CellphoneS", count: 50, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774070925/Gemini_Generated_Image_2cr3eq2cr3eq2cr3_ajy0rx.png', },
    water: { name: "Bình nước Samsung", count: 50, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774072459/Gemini_Generated_Image_wgqqr3wgqqr3wgqq_dsvkis.png', },
    none: { name: "CHÚC BẠN MAY MẮN LẦN SAU", count: 100, img: '', icon: '🍀' }
  });

  const [gridItems, setGridItems] = useState<GiftType[]>([]);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [gameActive, setGameActive] = useState(true);
  const [flipLogs, setFlipLogs] = useState<LogEntry[]>([]);
  
  const [showAdmin, setShowAdmin] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [currentResultType, setCurrentResultType] = useState<GiftType | null>(null);

  // Admin form state
  const [adminForm, setAdminForm] = useState<Record<string, { count: number, img: string }>>({
    tote: { count: 2, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774071594/Gemini_Generated_Image_wgqqr3wgqqr3wgqq_dsvkis.png' },
    acc: { count: 2, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774070925/Gemini_Generated_Image_2cr3eq2cr3eq2cr3_ajy0rx.png' },
    water: { count: 2, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774070926/Gemini_Generated_Image_nb5prinb5prinb5p_kv2opi.png' }
  });

  useEffect(() => {
    initGame();
  }, []);

  const initGame = () => {
    setGameActive(true);
    setFlippedIndex(null);
    setShowResult(false);
    setCurrentResultType(null);

    let items: GiftType[] = [];
    
    // Logic: Pick up to 2 of each gift if in stock, then fill remaining with 'none'
    (['tote', 'acc', 'water'] as GiftType[]).forEach(key => {
      let limit = Math.min(inventory[key].count, 2);
      for(let i=0; i<limit; i++) items.push(key);
    });

    while(items.length < 9) {
      items.push('none');
    }

    // Shuffle items
    items = items.sort(() => Math.random() - 0.5);
    setGridItems(items);
  };

  const handleFlip = (index: number, type: GiftType) => {
    if (!gameActive || flippedIndex !== null) return;

    setGameActive(false);
    setFlippedIndex(index);

    // Log entry
    const logEntry: LogEntry = {
      timestamp: new Date().toLocaleString('vi-VN'),
      result: inventory[type].name,
      type: type === 'none' ? 'Trượt' : 'Trúng quà'
    };
    setFlipLogs(prev => [...prev, logEntry]);

    // If it's a gift, decrement stock
    if (type !== 'none' && inventory[type].count > 0) {
      setInventory(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          count: prev[type].count - 1
        }
      }));
    }

    // Show result after animation
    setTimeout(() => {
      setCurrentResultType(type);
      setShowResult(true);
    }, 800);
  };

  const resetGame = () => {
    initGame();
  };

  const toggleAdmin = () => {
    if (!showAdmin) {
      // Sync form with current inventory when opening
      setAdminForm({
        tote: { count: inventory.tote.count, img: inventory.tote.img },
        acc: { count: inventory.acc.count, img: inventory.acc.img },
        water: { count: inventory.water.count, img: inventory.water.img }
      });
    }
    setShowAdmin(!showAdmin);
  };

  const handleAdminChange = (key: string, field: 'count' | 'img', value: string | number) => {
    setAdminForm(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }));
  };

  const saveAdminSettings = () => {
    setInventory(prev => ({
      ...prev,
      tote: { ...prev.tote, count: adminForm.tote.count, img: adminForm.tote.img },
      acc: { ...prev.acc, count: adminForm.acc.count, img: adminForm.acc.img },
      water: { ...prev.water, count: adminForm.water.count, img: adminForm.water.img }
    }));
    setShowAdmin(false);
    resetGame();
  };

  const exportLogs = () => {
    if (flipLogs.length === 0) {
      alert("Chưa có dữ liệu lượt chơi nào để xuất!");
      return;
    }

    let csvContent = "\uFEFF"; // UTF-8 BOM for Excel
    csvContent += "STT,Thời gian,Kết quả,Loại\n";
    
    flipLogs.forEach((log, index) => {
      csvContent += `${index + 1},${log.timestamp},${log.result},${log.type}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `nhat_ky_lat_o_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-white">
      <div 
  className="flip-card-front flex items-center justify-center"
  style={{
    backgroundImage: "url('https://res.cloudinary.com/dxikjdqqn/image/upload/v1774074114/Untitled-1_ykoqu4.png')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat"
  }}
></div>
      {/* Header */}
<header className="p-4 flex justify-between items-center border-b border-gray-100 shadow-sm bg-red-700 sticky top-0 z-10">
  <div className="logo-box"></div>

  <button
    onClick={toggleAdmin}
    className="text-gray-400 hover:text-red-600 transition p-2 cursor-pointer"
  >
    <Settings className="h-6 w-6" />
  </button>
</header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-6">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-red-600 mb-2 uppercase tracking-tighter">LẬT Ô NHẬN QUÀ </h1>
          <p className="text-red-600">Chọn 1 ô bất kỳ để nhận quà may mắn!</p>
        </div>

        {/* Game Grid */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-md aspect-square">
          {gridItems.map((type, index) => {
            const isFlipped = flippedIndex === index;
            const item = inventory[type];
            
            return (
              <div key={index} className={`flip-card ${isFlipped ? 'flipped' : ''}`}>
                <div className="flip-card-inner" onClick={() => handleFlip(index, type)}>
                  <div className="flip-card-front">
                    <span className="text-4xl font-bold opacity-20">?</span>
                  </div>
                  <div className="flip-card-back flex-col">
                    {item.img ? (
                      <img src={item.img} alt={item.name} className="gift-image" />
                    ) : (
                      <>
                        <span className="text-4xl mb-2">{item.icon}</span>
                        <span className="text-[10px] font-bold uppercase leading-tight px-2">{item.name}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>


      </main>

      {/* Admin Modal */}
      {showAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 uppercase">Cài đặt hệ thống</h2>
              <button onClick={toggleAdmin} className="text-gray-400 hover:text-red-600 transition cursor-pointer">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              {(['tote', 'acc', 'water'] as const).map(key => {
                const item = inventory[key];
                return (
                  <div key={key} className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                    <label className="block text-sm font-bold text-red-600 mb-3 uppercase tracking-wider">{item.name}</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Số lượng kho</label>
                        <input 
                          type="number" 
                          value={adminForm[key].count} 
                          onChange={(e) => handleAdminChange(key, 'count', parseInt(e.target.value) || 0)}
                          min="0" 
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Link Ảnh Cloudinary</label>
                        <input 
                          type="text" 
                          value={adminForm[key].img} 
                          onChange={(e) => handleAdminChange(key, 'img', e.target.value)}
                          placeholder="https://res.cloudinary.com/..."
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-xs"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 space-y-3">
              <button onClick={saveAdminSettings} className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition cursor-pointer">
                LƯU THAY ĐỔI
              </button>
              <button onClick={exportLogs} className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-bold hover:bg-gray-200 transition flex items-center justify-center gap-2 cursor-pointer">
                <Download className="h-5 w-5" />
                XUẤT FILE NHẬT KÝ (LOG)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Win/Loss Notification Overlay */}
      {showResult && currentResultType && (
        <div className="fixed inset-0 bg-white/95 flex flex-col items-center justify-center z-40 text-center p-6 backdrop-blur-sm">
          <div className="mb-6 w-72 h-72 md:w-96 md:h-96 flex items-center justify-center">
            {inventory[currentResultType].img ? (
              <img src={inventory[currentResultType].img} alt="Gift" className="w-full h-full object-contain drop-shadow-2xl scale-110" />
            ) : (
              <span className="text-[10rem]">{inventory[currentResultType].icon}</span>
            )}
          </div>
          <h2 className={`mb-6 ${currentResultType === 'none' ? "text-2xl font-bold text-gray-500" : "text-3xl font-bold text-red-600 scale-110 transition-all"}`}>
            {inventory[currentResultType].name}
          </h2>
          <button onClick={resetGame} className="bg-red-600 text-white px-10 py-3 rounded-full font-bold shadow-xl cursor-pointer hover:bg-red-700 transition">
            TIẾP TỤC
          </button>
        </div>
      )}
    </div>
  );
}
