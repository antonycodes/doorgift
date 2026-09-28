import { useEffect, useRef, useState } from 'react';
import { Settings, Download, X, LogOut, CheckCircle2, AlertCircle, ImagePlus } from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import { db, auth, signInWithGoogle, logOut } from './firebase';
import {
  doc,
  onSnapshot,
  setDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
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
  createdAt?: unknown;
}

const DEFAULT_INVENTORY: Record<GiftType, InventoryItem> = {
  mug: {
    name: 'Ly sứ CPS',
    count: 5,
    img: 'https://res.cloudinary.com/antony12/image/upload/v1787635922/vghkyofaxoqm8ds9gper.png',
    icon: '☕',
  },
  tetBag: {
    name: 'Túi PK tết',
    count: 70,
    img: 'https://res.cloudinary.com/antony12/image/upload/v1787635917/qryximejefd33gnitcee.png',
    icon: '🧧',
  },
  cottonBag: {
    name: 'Túi bông',
    count: 20,
    img: 'https://res.cloudinary.com/antony12/image/upload/v1788573138/T%C3%BAi_b%C3%B4ng_sm3ccs.png',
    icon: '🎒',
  },
  umbrella: {
    name: 'Dù CPS',
    count: 15,
    img: 'https://res.cloudinary.com/antony12/image/upload/v1787635907/xq3mp9rsbraffi2e653k.png',
    icon: '⛱️',
  },
  none: {
    name: 'CHÚC BẠN MAY MẮN LẦN SAU',
    count: 50,
    img: '',
    icon: '🍀',
  },
};

const RESULT_DELAY_MS = 500;
const RESET_DELAY_MS = 500;

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

const inventoryCollectionRef = () => collection(db, 'game', 'inventory', 'items');
const inventoryItemRef = (key: string) => doc(db, 'game', 'inventory', 'items', key);

async function saveInventoryItems(items: Record<string, InventoryItem>) {
  const current = await getDocs(inventoryCollectionRef());
  const desiredKeys = new Set(Object.keys(items));

  await Promise.all([
    ...Object.entries(items).map(([key, item]) => setDoc(inventoryItemRef(key), item)),
    ...current.docs
      .filter((itemDoc) => !desiredKeys.has(itemDoc.id))
      .map((itemDoc) => deleteDoc(itemDoc.ref)),
  ]);
}

function optimizeGiftImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('File không phải ảnh hợp lệ.'));
      image.onload = () => {
        const maxDimension = 900;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');

        if (!context) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh.'));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const optimizedImage = canvas.toDataURL('image/webp', 0.8);

        if (optimizedImage.length > 700_000) {
          reject(new Error('Ảnh vẫn quá lớn sau khi nén. Vui lòng chọn ảnh khác.'));
          return;
        }

        resolve(optimizedImage);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const sourceUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

    image.onload = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl);
      reject(new Error('Không thể đọc ảnh đã xử lý.'));
    };
    image.src = sourceUrl;
  });
}

async function composeStudioGiftImage(foreground: Blob): Promise<string> {
  const image = await loadImage(foreground);
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');

  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, '#f8fafc');
  background.addColorStop(1, '#e5e7eb');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(15, 23, 42, 0.12)';
  context.beginPath();
  context.ellipse(canvas.width / 2, canvas.height * 0.84, canvas.width * 0.24, canvas.height * 0.045, 0, 0, Math.PI * 2);
  context.fill();
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let result = canvas.toDataURL('image/webp', 0.82);
  if (result.length > 700_000) result = canvas.toDataURL('image/webp', 0.62);
  if (result.length > 700_000) throw new Error('Ảnh vẫn quá lớn sau khi xử lý. Vui lòng chọn ảnh khác.');
  return result;
}

async function processGiftImage(file: File, onProgress: (progress: number) => void): Promise<string> {
  const foreground = await removeBackground(file, {
    model: 'isnet_quint8',
    device: 'cpu',
    output: { format: 'image/png' },
    progress: (_key, current, total) => {
      onProgress(total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0);
    },
  });

  onProgress(100);
  return composeStudioGiftImage(foreground);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [inventory, setInventory] = useState<Record<GiftType, InventoryItem>>(DEFAULT_INVENTORY);
  const [gridItems, setGridItems] = useState<GiftType[]>([]);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [gameActive, setGameActive] = useState(true);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [currentResultType, setCurrentResultType] = useState<GiftType | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imageProcessingProgress, setImageProcessingProgress] = useState(0);
  const feedbackTimerRef = useRef<number | null>(null);

  const [adminInventory, setAdminInventory] = useState<Record<string, InventoryItem>>({});
  const [newItem, setNewItem] = useState({ id: '', name: '', count: 0, img: '' });

  useEffect(() => {
    const adminEmails = new Set<string>([
      'nhanntl18402@gmail.com',
      'vuuloc123@gmail.com',
      'nhannguyen.cellphones@gmail.com',
    ]);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      const email = currentUser?.email;
      setIsAdmin(Boolean(currentUser?.emailVerified && email && adminEmails.has(email)));
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setInventory(DEFAULT_INVENTORY);
      return;
    }

    const unsubscribe = onSnapshot(inventoryCollectionRef(), (snapshot) => {
      if (snapshot.empty) {
        if (isAdmin) {
          void saveInventoryItems(DEFAULT_INVENTORY).catch(console.error);
        }
        return;
      }

      const nextInventory: Record<GiftType, InventoryItem> = {};
      snapshot.forEach((itemDoc) => {
        nextInventory[itemDoc.id] = itemDoc.data() as InventoryItem;
      });
      setInventory(nextInventory);
    });

    return unsubscribe;
  }, [user, isAdmin]);

  useEffect(() => {
    initGame(inventory);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = (nextFeedback: Feedback) => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback(nextFeedback);
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, 3500);
  };

  const getActionErrorMessage = (error: unknown, action: string) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') {
      return `Không thể ${action}: tài khoản chưa có quyền quản trị hoặc chưa xác minh email.`;
    }
    return `Không thể ${action}. Vui lòng thử lại.`;
  };

  const generateGridItems = (currentInventory: Record<GiftType, InventoryItem>) => {
    let pool: GiftType[] = [];

    Object.keys(currentInventory).forEach((key) => {
      for (let i = 0; i < currentInventory[key].count; i += 1) {
        pool.push(key);
      }
    });

    pool = pool.sort(() => Math.random() - 0.5);
    const items = pool.slice(0, 9);

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
      alert('Vui lòng đăng nhập để chơi!');
      void signInWithGoogle();
      return;
    }

    if (!gameActive || flippedIndex !== null) return;

    const selectedItem = inventory[type];
    if (!selectedItem) return;

    setGameActive(false);
    setFlippedIndex(index);

    const logEntry = {
      timestamp: new Date().toLocaleString('vi-VN'),
      result: selectedItem.name,
      type: type === 'none' ? 'Trượt' : 'Trúng quà',
      userName: user.displayName || 'Người chơi',
      userEmail: user.email || 'Ẩn danh',
      userId: user.uid || 'unknown',
      createdAt: serverTimestamp(),
    };

    try {
      const inventoryRef = inventoryItemRef(type);

      await runTransaction(db, async (transaction) => {
        const inventorySnapshot = await transaction.get(inventoryRef);
        if (!inventorySnapshot.exists()) {
          throw new Error('Món quà không còn trong kho.');
        }

        const latestItem = inventorySnapshot.data() as InventoryItem;
        if (latestItem.count <= 0) {
          throw new Error('Món quà này vừa hết trong kho.');
        }

        transaction.update(inventoryRef, { count: latestItem.count - 1 });
      });

      await addDoc(collection(db, 'logs'), logEntry);
    } catch (error) {
      console.error('Lỗi lưu kết quả', error);
      setGameActive(true);
      setFlippedIndex(null);
      alert(error instanceof Error ? error.message : 'Không thể lưu kết quả. Vui lòng thử lại.');
      return;
    }

    window.setTimeout(() => {
      setCurrentResultType(type);
      setShowResult(true);
    }, RESULT_DELAY_MS);
  };

  const resetGame = (overrideInventory?: Record<GiftType, InventoryItem>) => {
    setShowResult(false);
    setFlippedIndex(null);

    window.setTimeout(() => {
      setGridItems(generateGridItems(overrideInventory || inventory));
      setCurrentResultType(null);
      setGameActive(true);
    }, RESET_DELAY_MS);
  };

  const toggleAdmin = () => {
    if (!showAdmin) {
      setAdminInventory(JSON.parse(JSON.stringify(inventory)) as Record<string, InventoryItem>);
      setNewItem({ id: '', name: '', count: 0, img: '' });
    }
    setShowAdmin(!showAdmin);
  };

  const handleAdminChange = (
    key: string,
    field: keyof InventoryItem,
    value: string | number,
  ) => {
    setAdminInventory((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const handleAddNewItem = () => {
    if (!newItem.id || !newItem.name) {
      alert('Vui lòng nhập mã và tên quà!');
      return;
    }

    if (adminInventory[newItem.id]) {
      alert('Mã quà này đã tồn tại!');
      return;
    }

    setAdminInventory((prev) => ({
      ...prev,
      [newItem.id]: {
        name: newItem.name,
        count: newItem.count,
        img: newItem.img,
        icon: '🎁',
      },
    }));
    setNewItem({ id: '', name: '', count: 0, img: '' });
  };

  const handleNewItemImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showFeedback({ type: 'error', message: 'Vui lòng chọn đúng file hình ảnh.' });
      return;
    }

    setIsProcessingImage(true);
    setImageProcessingProgress(0);

    try {
      const image = await processGiftImage(file, setImageProcessingProgress);
      setNewItem(prev => ({ ...prev, img: image }));
      showFeedback({ type: 'success', message: 'Đã xóa nền và thêm nền studio' });
    } catch (error) {
      try {
        const originalImage = await optimizeGiftImage(file);
        setNewItem(prev => ({ ...prev, img: originalImage }));
        showFeedback({ type: 'error', message: 'AI không xử lý được. Đã dùng ảnh gốc.' });
      } catch (fallbackError) {
        showFeedback({
          type: 'error',
          message: fallbackError instanceof Error ? fallbackError.message : 'Không thể xử lý ảnh. Vui lòng thử lại.'
        });
      }
    } finally {
      setIsProcessingImage(false);
      setImageProcessingProgress(0);
    }
  };

  const handleRemoveItem = (key: string) => {
    if (key === 'none') {
      alert('Không thể xóa ô Chúc may mắn lần sau!');
      return;
    }

    setAdminInventory((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const saveAdminSettings = async () => {
    if (!isAdmin || isSaving || isResetting) return;
    setIsSaving(true);
    try {
      await saveInventoryItems(adminInventory);
      setInventory(adminInventory);
      setShowAdmin(false);
      resetGame(adminInventory);
      showFeedback({ type: 'success', message: 'Đã lưu thay đổi thành công' });
    } catch (error) {
      console.error('Lỗi lưu cài đặt', error);
      showFeedback({ type: 'error', message: getActionErrorMessage(error, 'lưu thay đổi') });
    } finally {
      setIsSaving(false);
    }
  };

  const exportLogs = async () => {
    if (!isAdmin) return;

    try {
      const snapshot = await getDocs(query(collection(db, 'logs'), orderBy('createdAt', 'asc')));
      const logs: LogEntry[] = [];
      snapshot.forEach((itemDoc) => logs.push(itemDoc.data() as LogEntry));

      if (logs.length === 0) {
        alert('Chưa có dữ liệu lượt chơi nào để xuất!');
        return;
      }

      let csvContent = '\uFEFF';
      csvContent += 'TỔNG HỢP QUÀ TẶNG,,,\n';
      csvContent += 'Loại quà,Ban đầu,Đã phát,Còn lại\n';

      Object.keys(inventory).forEach((key) => {
        const item = inventory[key];
        const distributed = logs.filter((log) => log.result === item.name).length;
        const remaining = item.count;
        const initial = distributed + remaining;
        csvContent += `"${item.name}",${initial},${distributed},${remaining}\n`;
      });

      csvContent += '\nCHI TIẾT LƯỢT CHƠI,,,,,\n';
      csvContent += 'STT,Thời gian,Tên người chơi,Email,Kết quả,Loại\n';

      logs.forEach((log, index) => {
        csvContent += `${index + 1},${log.timestamp},"${log.userName || 'Người chơi'}","${log.userEmail || 'Ẩn danh'}","${log.result}",${log.type}\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `nhat_ky_lat_o_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Lỗi xuất dữ liệu', error);
    }
  };

  const handleResetData = async () => {
    if (!isAdmin || isSaving || isResetting) return;
    setIsResetting(true);
    try {
      await saveInventoryItems(DEFAULT_INVENTORY);

      const snapshot = await getDocs(collection(db, 'logs'));
      const deletePromises = snapshot.docs.map((itemDoc) => deleteDoc(itemDoc.ref));
      await Promise.all(deletePromises);

      setInventory(DEFAULT_INVENTORY);
      setShowConfirmReset(false);
      setShowAdmin(false);
      resetGame(DEFAULT_INVENTORY);
      showFeedback({ type: 'success', message: 'Đã khôi phục dữ liệu gốc thành công' });
    } catch (error) {
      console.error('Lỗi khôi phục dữ liệu', error);
      showFeedback({ type: 'error', message: getActionErrorMessage(error, 'khôi phục dữ liệu gốc') });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col font-sans"
      style={{
        backgroundImage: "url('')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="p-4 flex justify-between items-center border-b border-gray-100 shadow-sm bg-red-700 sticky top-0 z-10">
        <div className="logo-box"></div>

        <div className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 shadow-inner">
          {!user ? (
            <button onClick={() => void signInWithGoogle()} className="text-white text-sm font-semibold hover:text-red-200 transition cursor-pointer">
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

              {isAdmin && (
                <button onClick={toggleAdmin} className="text-white/80 hover:text-white transition cursor-pointer" title="Cài đặt">
                  <Settings className="h-4 w-4" />
                </button>
              )}

              <button onClick={logOut} className="text-white/80 hover:text-white transition cursor-pointer" title="Đăng xuất">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center p-6">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-red-600 mb-2 uppercase tracking-tighter">LẬT Ô NHẬN QUÀ</h1>
          <p className="text-red-600">Chọn 1 ô bất kỳ để nhận quà may mắn!</p>
        </div>

        <div className="grid grid-cols-3 gap-3 w-full max-w-md aspect-square">
          {gridItems.map((type, index) => {
            const isFlipped = flippedIndex === index;
            const item = inventory[type] || DEFAULT_INVENTORY.none;

            return (
              <div key={index} className={`flip-card ${isFlipped ? 'flipped' : ''}`}>
                <div className="flip-card-inner" onClick={() => void handleFlip(index, type)}>
                  <div
                    className="flip-card-front flex items-center justify-center"
                    style={{
                      backgroundImage: "url('https://res.cloudinary.com/antony12/image/upload/v1774162513/Find_xa0rni.jpg')",
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }}
                  ></div>
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
              {Object.keys(adminInventory).map((key) => {
                const item = adminInventory[key];
                const isNone = key === 'none';

                return (
                  <div key={key} className="p-4 border border-gray-100 rounded-xl bg-gray-50 relative">
                    {!isNone && (
                      <button onClick={() => handleRemoveItem(key)} className="absolute top-2 right-2 text-gray-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
                        {item.img ? (
                          <img src={item.img} alt={item.name} className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-2xl">{item.icon || '🎁'}</span>
                        )}
                      </div>
                      <label className="block text-sm font-bold text-red-600 uppercase tracking-wider">
                        {isNone ? 'CHÚC MAY MẮN LẦN SAU (TRƯỢT)' : item.name}
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {!isNone && (
                        <div className="md:col-span-2">
                          <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Tên quà</label>
                          <input
                            type="text"
                            value={item.name}
                            onChange={(event) => handleAdminChange(key, 'name', event.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Số lượng kho</label>
                        <input
                          type="number"
                          value={item.count}
                          onChange={(event) => handleAdminChange(key, 'count', Number.parseInt(event.target.value, 10) || 0)}
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
                            onChange={(event) => handleAdminChange(key, 'img', event.target.value)}
                            placeholder="https://res.cloudinary.com/..."
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-xs"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="p-4 border-2 border-dashed border-gray-300 rounded-xl bg-white">
                <label className="block text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">THÊM QUÀ MỚI</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Mã quà (viết liền không dấu)</label>
                    <input
                      type="text"
                      value={newItem.id}
                      onChange={(event) => setNewItem({ ...newItem, id: event.target.value })}
                      placeholder="vd: voucher50k"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Tên quà hiển thị</label>
                    <input
                      type="text"
                      value={newItem.name}
                      onChange={(event) => setNewItem({ ...newItem, name: event.target.value })}
                      placeholder="vd: Voucher 50.000đ"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Số lượng</label>
                    <input
                      type="number"
                      value={newItem.count}
                      onChange={(event) => setNewItem({ ...newItem, count: Number.parseInt(event.target.value, 10) || 0 })}
                      min="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-2">Ảnh quà</label>
                    <div className="flex items-center gap-3">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50">
                        {newItem.img ? (
                          <img src={newItem.img} alt="Xem trước quà mới" className="h-full w-full object-contain" />
                        ) : (
                          <ImagePlus className="h-7 w-7 text-gray-400" />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className={`inline-flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-white transition ${isProcessingImage ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-gray-900'}`}>
                          <ImagePlus className="h-4 w-4" />
                          {isProcessingImage ? `ĐANG XỬ LÝ ${imageProcessingProgress}%` : 'CHỌN ẢNH'}
                          <input type="file" accept="image/*" onChange={handleNewItemImageChange} disabled={isProcessingImage} className="hidden" />
                        </label>
                        {newItem.img && !isProcessingImage && (
                          <button
                            type="button"
                            onClick={() => setNewItem(prev => ({ ...prev, img: '' }))}
                            className="rounded-lg px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                          >
                            XÓA ẢNH
                          </button>
                        )}
                        <p className="basis-full text-[10px] text-gray-400">Ảnh sẽ được nén tự động trước khi lưu.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <button onClick={handleAddNewItem} className="w-full bg-gray-800 text-white py-2 rounded-lg font-bold hover:bg-gray-900 transition cursor-pointer text-sm">
                  + THÊM QUÀ NÀY
                </button>
              </div>
            </div>

            <div className="mt-8 space-y-3">
              <button
                onClick={saveAdminSettings}
                disabled={isSaving || isResetting}
                className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition cursor-pointer disabled:cursor-wait disabled:opacity-60"
              >
                {isSaving ? 'ĐANG LƯU...' : 'LƯU THAY ĐỔI'}
              </button>
              <button onClick={exportLogs} className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-bold hover:bg-gray-200 transition flex items-center justify-center gap-2 cursor-pointer">
                <Download className="h-5 w-5" />
                XUẤT FILE NHẬT KÝ (LOG)
              </button>
              <button
                onClick={() => setShowConfirmReset(true)}
                disabled={isSaving || isResetting}
                className="w-full bg-red-100 text-red-700 py-3 rounded-lg font-bold hover:bg-red-200 transition cursor-pointer mt-4 disabled:cursor-not-allowed disabled:opacity-60"
              >
                KHÔI PHỤC DỮ LIỆU GỐC
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmReset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Xác nhận khôi phục</h3>
            <p className="text-gray-600 mb-8">Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (số lượng quà, lịch sử lật) và khôi phục về mặc định? Hành động này không thể hoàn tác.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmReset(false)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200 transition cursor-pointer">
                HỦY
              </button>
              <button
                onClick={handleResetData}
                disabled={isResetting || isSaving}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition cursor-pointer disabled:cursor-wait disabled:opacity-60"
              >
                {isResetting ? 'ĐANG KHÔI PHỤC...' : 'KHÔI PHỤC'}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`toast-enter fixed top-20 right-4 z-[70] flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-xl ${
            feedback.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {showResult && currentResultType && (
        <div className="fixed inset-0 bg-white/95 flex flex-col items-center justify-center z-40 text-center p-6 backdrop-blur-sm">
          <div className="mb-6 w-72 h-72 md:w-96 md:h-96 flex items-center justify-center">
            {inventory[currentResultType].img ? (
              <img src={inventory[currentResultType].img} alt="Gift" className="w-full h-full object-contain drop-shadow-2xl scale-110" />
            ) : (
              <span className="text-[10rem]">{inventory[currentResultType].icon}</span>
            )}
          </div>
          <h2 className={`mb-6 ${currentResultType === 'none' ? 'text-2xl font-bold text-gray-500' : 'text-3xl font-bold text-red-600 scale-110 transition-all'}`}>
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
