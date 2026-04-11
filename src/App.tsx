import React, { useState, useEffect } from 'react';
import { Settings, Download, X, LogOut } from 'lucide-react';
import { db, auth, signInWithGoogle, logOut } from './firebase';
import { doc, onSnapshot, setDoc, collection, addDoc, getDocs, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';

type GiftType = string;

interface InventoryItem {
  name: string;
  count: number;
  img: string;
  icon?: string;
}

interface LogEntry {
  timestamp: string;
  result: string;
  type: string;
  userName?: string;
  userEmail?: string;
  userId?: string;
  createdAt?: any;
}

const DEFAULT_INVENTORY: Record<GiftType, InventoryItem> = {
  tote: { name: "Túi tote Samsung", count: 30, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774072448/Gemini_Generated_Image_7ab5q07ab5q07ab5_lcrwcz.png', icon: '🎒' },
  acc: { name: "Ly sứ CellphoneS", count: 57, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1775879290/Ly_s%E1%BB%A9_2_nzptis.png', icon: '💼' },
  water: { name: "Túi tote CellphoneS", count: 2, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1775879246/T%C3%BAi_CPS_ke06nf.png', icon: '🥤' },
  shirt: { name: "Pin cài áo Samsung", count: 0, img: 'https://res.cloudinary.com/dxikjdqqn/image/upload/v1774579962/Gemini_Generated_Image_gf89gjgf89gjgf89_hswllc.png' },
  none: { name: "CHÚC BẠN MAY MẮN LẦN SAU", count: 85, img: '', icon: '🍀' }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [inventory, setInventory] = useState<Record<GiftType, InventoryItem>>(DEFAULT_INVENTORY);
  const [gridItems, setGridItems] = useState<GiftType[]>([]);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [gameActive, setGameActive] = useState(true);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [currentResultType, setCurrentResultType] = useState<GiftType | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  // Admin form state
  const [adminInventory, setAdminInventory] = useState<Record<string, InventoryItem>>({});
  const [newItem, setNewItem] = useState({ id: '', name: '', count: 0, img: '' });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubInventory = onSnapshot(doc(db, 'game', 'inventory'), (docSnap) => {
      if (docSnap.exists()) {
        try {
          const data = JSON.parse(docSnap.data().items);
          setInventory(data);
        } catch (e) {
          console.error("Failed to parse inventory from Firestore", e);
        }
      } else {
        // Initialize default inventory if it doesn't exist
        if (user?.email === 'nhanntl18402@gmail.com') {
          setDoc(doc(db, 'game', 'inventory'), { items: JSON.stringify(DEFAULT_INVENTORY) }).catch(console.error);
        }
      }
    });

    return () => unsubInventory();
  }, [user]);

  useEffect(() => {
    initGame(inventory);
  }, []); // Run once on mount to generate initial grid

  const generateGridItems = (currentInventory: Record<GiftType, InventoryItem>) => {
    let pool: GiftType[] = [];
    Object.keys(currentInventory).forEach(key => {
      for (let i = 0; i < currentInventory[key].count; i++) pool.push(key);
    });
    pool = pool.sort(() => Math.random() - 0.5);
    let items = pool.slice(0, 9);
    while (items.length < 9) {
      items.push('none');
    }
    return items.sort(() => Math.random() - 0.5);
  };

  const initGame = (currentInventory: Record<GiftType, InventoryItem>) => {
    setGameActive(true);
    setFlippedIndex(null);
    setShowResult(false);
    setCurrentResultType(null);
    setGridItems(generateGridItems(currentInventory));
  };

  const handleFlip = async (index: number, type: GiftType) => {
    if (!user) {
      alert("Vui lòng đăng nhập để chơi!");
      signInWithGoogle();
      return;
    }

    if (!gameActive || flippedIndex !== null) return;

    setGameActive(false);
    setFlippedIndex(index);

    const logEntry = {
      timestamp: new Date().toLocaleString('vi-VN'),
      result: inventory[type].name,
      type: type === 'none' ? 'Trượt' : 'Trúng quà',
      userName: user.displayName || 'Người chơi',
      userEmail: user.email || 'Ẩn danh',
      userId: user.uid || 'unknown',
      createdAt: serverTimestamp()
    };

    let newInventory = { ...inventory };
    if (type !== 'none' && inventory[type].count > 0) {
      newInventory = {
        ...inventory,
        [type]: {
          ...inventory[type],
          count: inventory[type].count - 1
        }
      };
    }

    try {
      await setDoc(doc(db, 'game', 'inventory'), { items: JSON.stringify(newInventory) });
      await addDoc(collection(db, 'logs'), logEntry);
    } catch (error) {
      console.error("Lỗi lưu kết quả", error);
    }

    setTimeout(() => {
      setCurrentResultType(type);
      setShowResult(true);
    }, 600);
  };

  const resetGame = (overrideInventory?: Record<GiftType, InventoryItem>) => {
    setShowResult(false);
    setFlippedIndex(null);

    setTimeout(() => {
      setGridItems(generateGridItems(overrideInventory || inventory));
      setCurrentResultType(null);
      setGameActive(true);
    }, 600);
  };

  const toggleAdmin = () => {
    if (!showAdmin) {
      setAdminInventory(JSON.parse(JSON.stringify(inventory)));
      setNewItem({ id: '', name: '', count: 0, img: '' });
    }
    setShowAdmin(!showAdmin);
  };

  const handleAdminChange = (key: string, field: keyof InventoryItem, value: string | number) => {
    setAdminInventory(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }));
  };

  const handleAddNewItem = () => {
    if (!newItem.id || !newItem.name) {
      alert("Vui lòng nhập mã và tên quà!");
      return;
    }
    if (adminInventory[newItem.id]) {
      alert("Mã quà này đã tồn tại!");
      return;
    }
    setAdminInventory(prev => ({
      ...prev,
      [newItem.id]: {
        name: newItem.name,
        count: newItem.count,
        img: newItem.img,
        icon: '🎁'
      }
    }));
    setNewItem({ id: '', name: '', count: 0, img: '' });
  };

  const handleRemoveItem = (key: string) => {
    if (key === 'none') {
      alert("Không thể xóa ô Chúc may mắn lần sau!");
      return;
    }
    setAdminInventory(prev => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const saveAdminSettings = async () => {
    try {
      await setDoc(doc(db, 'game', 'inventory'), { items: JSON.stringify(adminInventory) });
      setShowAdmin(false);
      resetGame(adminInventory);
    } catch (error) {
      console.error("Lỗi lưu cài đặt", error);
    }
  };

  const exportLogs = async () => {
    try {
      const snapshot = await getDocs(query(collection(db, 'logs'), orderBy('createdAt', 'asc')));
      const logs: LogEntry[] = [];
      snapshot.forEach(d => logs.push(d.data() as LogEntry));

      if (logs.length === 0) {
        alert("Chưa có dữ liệu lượt chơi nào để xuất!");
        return;
      }

      let csvContent = "\uFEFF"; // UTF-8 BOM for Excel

      // Phần tổng hợp
      csvContent += "TỔNG HỢP QUÀ TẶNG,,,\n";
      csvContent += "Loại quà,Ban đầu,Đã phát,Còn lại\n";

      Object.keys(inventory).forEach(key => {
        const item = inventory[key];
        const distributed = logs.filter(log => log.result === item.name).length;
        const remaining = item.count;
        const initial = distributed + remaining;
        csvContent += `"${item.name}",${initial},${distributed},${remaining}\n`;
      });

      csvContent += "\nCHI TIẾT LƯỢT CHƠI,,,,,\n";
      csvContent += "STT,Thời gian,Tên người chơi,Email,Kết quả,Loại\n";

      logs.forEach((log, index) => {
        csvContent += `${index + 1},${log.timestamp},"${log.userName || 'Người chơi'}","${log.userEmail || 'Ẩn danh'}","${log.result}",${log.type}\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `nhat_ky_lat_o_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Lỗi xuất dữ liệu", error);
    }
  };

  const handleResetData = async () => {
    try {
      await setDoc(doc(db, 'game', 'inventory'), { items: JSON.stringify(DEFAULT_INVENTORY) });
      
      const snapshot = await getDocs(collection(db, 'logs'));
      const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'logs', d.id)));
      await Promise.all(deletePromises);

      setShowConfirmReset(false);
      setShowAdmin(false);
      resetGame(DEFAULT_INVENTORY);
    } catch (error) {
      console.error("Lỗi khôi phục dữ liệu", error);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col font-sans"
      style={{
        backgroundImage: "url('https://res.cloudinary.com/dxikjdqqn/image/upload/v1774074114/Untitled-1_ykoqu4.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed"
      }}
    >
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-100 shadow-sm bg-red-700 sticky top-0 z-10">
        <div className="logo-box"></div>

        <div className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 shadow-inner">
          {!user ? (
            <button onClick={signInWithGoogle} className="text-white text-sm font-semibold hover:text-red-200 transition cursor-pointer">
              Đăng nhập
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2" title={user.email || ''}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-7 h-7 rounded-full border border-white/30 shadow-sm" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold border border-white/30 shadow-sm">
                    {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                  </div>
                )}
                <span className="text-white text-sm font-medium hidden sm:block max-w-[120px] truncate">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
              </div>
              
              <div className="w-px h-4 bg-white/30"></div>
              
              {user?.email === 'nhanntl18402@gmail.com' && (
                <button
                  onClick={toggleAdmin}
                  className="text-white/80 hover:text-white transition cursor-pointer"
                  title="Cài đặt"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
              
              <button 
                onClick={logOut} 
                className="text-white/80 hover:text-white transition cursor-pointer"
                title="Đăng xuất"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
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
            const item = inventory[type] || DEFAULT_INVENTORY.none;

            return (
              <div key={index} className={`flip-card ${isFlipped ? 'flipped' : ''}`}>
                <div className="flip-card-inner" onClick={() => handleFlip(index, type)}>
                  <div
                    className="flip-card-front flex items-center justify-center"
                    style={{
                      backgroundImage: "url('https://res.cloudinary.com/dxikjdqqn/image/upload/v1774162513/Find_xa0rni.jpg')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat"
                    }}
                  >
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
              {Object.keys(adminInventory).map(key => {
                const item = adminInventory[key];
                const isNone = key === 'none';
                return (
                  <div key={key} className="p-4 border border-gray-100 rounded-xl bg-gray-50 relative">
                    {!isNone && (
                      <button onClick={() => handleRemoveItem(key)} className="absolute top-2 right-2 text-gray-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <label className="block text-sm font-bold text-red-600 mb-3 uppercase tracking-wider">
                      {isNone ? "CHÚC MAY MẮN LẦN SAU (TRƯỢT)" : item.name}
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {!isNone && (
                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Tên quà</label>
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleAdminChange(key, 'name', e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Số lượng kho</label>
                        <input
                          type="number"
                          value={item.count}
                          onChange={(e) => handleAdminChange(key, 'count', parseInt(e.target.value) || 0)}
                          min="0"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none"
                        />
                      </div>
                      {!isNone && (
                        <div className="hidden">
                          <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Link Ảnh Cloudinary</label>
                          <input
                            type="text"
                            value={item.img}
                            onChange={(e) => handleAdminChange(key, 'img', e.target.value)}
                            placeholder="https://res.cloudinary.com/..."
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-xs"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add new item form */}
              <div className="p-4 border-2 border-dashed border-gray-300 rounded-xl bg-white">
                <label className="block text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">THÊM QUÀ MỚI</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Mã quà (viết liền không dấu)</label>
                    <input
                      type="text"
                      value={newItem.id}
                      onChange={(e) => setNewItem({ ...newItem, id: e.target.value })}
                      placeholder="vd: voucher50k"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Tên quà hiển thị</label>
                    <input
                      type="text"
                      value={newItem.name}
                      onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                      placeholder="vd: Voucher 50.000đ"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Số lượng</label>
                    <input
                      type="number"
                      value={newItem.count}
                      onChange={(e) => setNewItem({ ...newItem, count: parseInt(e.target.value) || 0 })}
                      min="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none"
                    />
                  </div>
                  <div className="hidden">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Link Ảnh Cloudinary</label>
                    <input
                      type="text"
                      value={newItem.img}
                      onChange={(e) => setNewItem({ ...newItem, img: e.target.value })}
                      placeholder="https://res.cloudinary.com/..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-xs"
                    />
                  </div>
                </div>
                <button onClick={handleAddNewItem} className="w-full bg-gray-800 text-white py-2 rounded-lg font-bold hover:bg-gray-900 transition cursor-pointer text-sm">
                  + THÊM QUÀ NÀY
                </button>
              </div>
            </div>

            <div className="mt-8 space-y-3">
              <button onClick={saveAdminSettings} className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition cursor-pointer">
                LƯU THAY ĐỔI
              </button>
              <button onClick={exportLogs} className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-bold hover:bg-gray-200 transition flex items-center justify-center gap-2 cursor-pointer">
                <Download className="h-5 w-5" />
                XUẤT FILE NHẬT KÝ (LOG)
              </button>
              <button onClick={() => setShowConfirmReset(true)} className="w-full bg-red-100 text-red-700 py-3 rounded-lg font-bold hover:bg-red-200 transition cursor-pointer mt-4">
                KHÔI PHỤC DỮ LIỆU GỐC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Reset Modal */}
      {showConfirmReset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Xác nhận khôi phục</h3>
            <p className="text-gray-600 mb-8">Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (số lượng quà, lịch sử lật) và khôi phục về mặc định? Hành động này không thể hoàn tác.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmReset(false)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200 transition cursor-pointer">
                HỦY
              </button>
              <button onClick={handleResetData} className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition cursor-pointer">
                KHÔI PHỤC
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
          <button onClick={() => resetGame()} className="bg-red-600 text-white px-10 py-3 rounded-full font-bold shadow-xl cursor-pointer hover:bg-red-700 transition">
            TIẾP TỤC
          </button>
        </div>
      )}
    </div>
  );
}
