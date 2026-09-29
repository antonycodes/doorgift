import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Settings, Download, Save, RotateCcw, X, LogOut, CheckCircle2, AlertCircle, ImagePlus, Eye, EyeOff } from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import {
  auth,
  db,
  accountIdFromAuthEmail,
  normalizeAccountId,
  signInWithAccount,
  signInWithGoogle,
  logOut,
} from './firebase';
import {
  doc,
  onSnapshot,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';

type GiftType = string;
type LayoutOrientation = 'vertical' | 'horizontal';

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
  accountId?: string;
  createdAt?: unknown;
}

interface GameSettings {
  totalCheckins: number;
  giftIssueRate: number;
}

const DEFAULT_INVENTORY: Record<GiftType, InventoryItem> = {
  mug: {
    name: 'Ly sứ CPS',
    count: 5,
    img: '/gifts/ceramic-mug.jpg',
    icon: '☕',
  },
  tetBag: {
    name: 'Túi PK tết',
    count: 70,
    img: '/gifts/tet-accessory-pouch.jpg',
    icon: '🧧',
  },
  cottonBag: {
    name: 'Túi bông',
    count: 20,
    img: '/gifts/cotton-bag.jpg',
    icon: '🎒',
  },
  umbrella: {
    name: 'Dù CPS',
    count: 15,
    img: '/gifts/hand-umbrella.jpg',
    icon: '⛱️',
  },
  none: {
    name: 'CHÚC BẠN MAY MẮN LẦN SAU',
    count: 50,
    img: '',
    icon: '🍀',
  },
};

const COMMON_GIFT_PRESETS = [
  { id: 'accessoryPouchCps', name: 'Túi phụ kiện CPS', count: 0, img: '/gifts/accessory-pouch-cps.jpg', icon: '🎒' },
  { id: 'waterBottle', name: 'Bình nước CPS', count: 0, img: '/gifts/water-bottle-cps.jpg', icon: '🧴' },
  { id: 'toteCps', name: 'Túi Tote CPS', count: 0, img: '/gifts/tote-cps.jpg', icon: '👜' },
  { id: 'handUmbrella', name: 'Dù cầm tay', count: 0, img: '/gifts/hand-umbrella.jpg', icon: '☂️' },
  { id: 'tetBag', name: 'Túi phụ kiện Tết', count: 70, img: '/gifts/tet-accessory-pouch.jpg', icon: '🧧' },
  { id: 'mug', name: 'Ly sứ', count: 5, img: '/gifts/ceramic-mug.jpg', icon: '☕' },
  { id: 'accessoryPouch', name: 'Túi phụ kiện', count: 0, img: '/gifts/accessory-pouch.jpg', icon: '🧳' },
  { id: 'cottonBag', name: 'Túi bông', count: 20, img: '/gifts/cotton-bag.jpg', icon: '🎒' },
  { id: 'cpsBackpack', name: 'Balo CPS', count: 0, img: '/gifts/cps-backpack.jpg', icon: '🎒' },
  { id: 'asusBag', name: 'Balo ASUS', count: 0, img: '/gifts/asus-bag.jpg', icon: '🎒' },
];

const RESULT_DELAY_MS = 500;
const RESET_DELAY_MS = 500;
const DEFAULT_GAME_SETTINGS: GameSettings = {
  totalCheckins: 0,
  giftIssueRate: 90,
};

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

type ImageProcessStatus = 'idle' | 'processing' | 'success' | 'error';

const inventoryCollectionRef = () => collection(db, 'game', 'inventory', 'items');
const inventoryItemRef = (key: string) => doc(db, 'game', 'inventory', 'items', key);
const gameSettingsRef = () => doc(db, 'game', 'settings');
const accountNumberFromId = (accountId: string | null) => accountId?.match(/(?:^|_)(\d+)$/)?.[1] || null;

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

async function composeGiftImage(foreground: Blob): Promise<string> {
  const image = await loadImage(foreground);
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let result = canvas.toDataURL('image/webp', 0.82);
  if (result.length > 700_000) result = canvas.toDataURL('image/webp', 0.62);
  if (result.length > 700_000) throw new Error('Ảnh vẫn quá lớn sau khi xử lý. Vui lòng chọn ảnh khác.');
  return result;
}

async function processGiftImage(source: Blob | string, onProgress: (progress: number) => void): Promise<string> {
  const foreground = await removeBackground(source, {
    model: 'isnet_quint8',
    device: 'cpu',
    output: { format: 'image/png' },
    progress: (_key, current, total) => {
      onProgress(total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0);
    },
  });

  onProgress(100);
  return composeGiftImage(foreground);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [inventory, setInventory] = useState<Record<GiftType, InventoryItem>>(DEFAULT_INVENTORY);
  const [gridItems, setGridItems] = useState<GiftType[]>([]);
  const [layoutOrientation, setLayoutOrientation] = useState<LayoutOrientation>('vertical');
  const [isPhoneViewport, setIsPhoneViewport] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  ));
  const [gameSettings, setGameSettings] = useState<GameSettings>(DEFAULT_GAME_SETTINGS);
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
  const [imageProcessStatus, setImageProcessStatus] = useState<ImageProcessStatus>('idle');
  const [processingExistingItemKey, setProcessingExistingItemKey] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const [adminInventory, setAdminInventory] = useState<Record<string, InventoryItem>>({});
  const [adminLayoutOrientation, setAdminLayoutOrientation] = useState<LayoutOrientation>('vertical');
  const [adminTotalCheckins, setAdminTotalCheckins] = useState(DEFAULT_GAME_SETTINGS.totalCheckins);
  const [adminGiftIssueRate, setAdminGiftIssueRate] = useState(DEFAULT_GAME_SETTINGS.giftIssueRate);
  const [newItem, setNewItem] = useState({ id: '', name: '', count: 0, img: '' });
  const [selectedGiftPreset, setSelectedGiftPreset] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

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
    const phoneMediaQuery = window.matchMedia('(max-width: 767px)');
    const updatePhoneViewport = () => setIsPhoneViewport(phoneMediaQuery.matches);

    updatePhoneViewport();
    phoneMediaQuery.addEventListener('change', updatePhoneViewport);

    return () => phoneMediaQuery.removeEventListener('change', updatePhoneViewport);
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
    if (!user) {
      setLayoutOrientation('vertical');
      setGameSettings(DEFAULT_GAME_SETTINGS);
      return;
    }

    const unsubscribe = onSnapshot(gameSettingsRef(), (snapshot) => {
      const settings = snapshot.data() || {};
      const savedOrientation = settings.layoutOrientation;
      const savedTotalCheckins = Number(settings.totalCheckins);
      const savedGiftIssueRate = Number(settings.giftIssueRate);

      setLayoutOrientation(savedOrientation === 'horizontal' ? 'horizontal' : 'vertical');
      setGameSettings({
        totalCheckins: Number.isFinite(savedTotalCheckins) ? Math.max(0, Math.floor(savedTotalCheckins)) : DEFAULT_GAME_SETTINGS.totalCheckins,
        giftIssueRate: Number.isFinite(savedGiftIssueRate) ? Math.min(100, Math.max(0, savedGiftIssueRate)) : DEFAULT_GAME_SETTINGS.giftIssueRate,
      });
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!previewImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

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
      userId: user.uid,
      ...(accountIdFromAuthEmail(user.email)
        ? { accountId: accountIdFromAuthEmail(user.email) }
        : {}),
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
        transaction.set(doc(collection(db, 'logs')), logEntry);
      });
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
      setAdminLayoutOrientation(layoutOrientation);
      setAdminTotalCheckins(gameSettings.totalCheckins);
      setAdminGiftIssueRate(gameSettings.giftIssueRate);
      setNewItem({ id: '', name: '', count: 0, img: '' });
      setSelectedGiftPreset('');
      setImageProcessStatus('idle');
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
        icon: COMMON_GIFT_PRESETS.find(preset => preset.id === selectedGiftPreset)?.icon || '🎁',
      },
    }));
    setNewItem({ id: '', name: '', count: 0, img: '' });
    setSelectedGiftPreset('');
    setImageProcessStatus('idle');
  };

  const handleGiftPresetChange = (presetId: string) => {
    setSelectedGiftPreset(presetId);
    const preset = COMMON_GIFT_PRESETS.find(item => item.id === presetId);
    if (!preset) {
      setNewItem({ id: '', name: '', count: 0, img: '' });
      setImageProcessStatus('idle');
      return;
    }

    setNewItem({
      id: preset.id,
      name: preset.name,
      count: preset.count,
      img: preset.img,
    });
    setImageProcessStatus('idle');
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
    setImageProcessStatus('processing');

    try {
      const image = await processGiftImage(file, setImageProcessingProgress);
      setNewItem(prev => ({ ...prev, img: image }));
      setImageProcessStatus('success');
      showFeedback({ type: 'success', message: 'Đã xóa nền ảnh quà thành công' });
    } catch (error) {
      try {
        const originalImage = await optimizeGiftImage(file);
        setNewItem(prev => ({ ...prev, img: originalImage }));
        setImageProcessStatus('error');
        showFeedback({ type: 'error', message: 'AI không xử lý được. Đã dùng ảnh gốc.' });
      } catch (fallbackError) {
        setImageProcessStatus('error');
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

  const handleExistingItemBackgroundRemoval = async (key: string) => {
    const item = adminInventory[key];
    if (!item?.img || isProcessingImage || processingExistingItemKey) return;

    setProcessingExistingItemKey(key);
    try {
      const processedImage = await processGiftImage(item.img, () => undefined);
      setAdminInventory(prev => ({
        ...prev,
        [key]: { ...prev[key], img: processedImage },
      }));
      showFeedback({ type: 'success', message: `Đã tách nền cho ${item.name}` });
    } catch (error) {
      console.error('Lỗi tách nền ảnh cũ', error);
      showFeedback({ type: 'error', message: 'Không thể tách nền ảnh này. Vui lòng thử lại.' });
    } finally {
      setProcessingExistingItemKey(null);
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

    const totalGiftStock = Object.entries(adminInventory)
      .filter(([key]) => key !== 'none')
      .reduce((total, [, item]) => total + Math.max(0, Math.floor(item.count)), 0);
    const giftsToIssue = Math.min(
      totalGiftStock,
      Math.floor(totalGiftStock * adminGiftIssueRate / 100),
    );
    const nextLuckCount = adminTotalCheckins > 0
      ? Math.max(0, adminTotalCheckins - giftsToIssue)
      : adminInventory.none?.count || 0;
    const nextInventory = adminInventory.none
      ? {
          ...adminInventory,
          none: { ...adminInventory.none, count: nextLuckCount },
        }
      : adminInventory;

    setIsSaving(true);
    try {
      await saveInventoryItems(nextInventory);
      await setDoc(gameSettingsRef(), {
        layoutOrientation: adminLayoutOrientation,
        totalCheckins: adminTotalCheckins,
        giftIssueRate: adminGiftIssueRate,
      }, { merge: true });
      setInventory(nextInventory);
      setGameSettings({ totalCheckins: adminTotalCheckins, giftIssueRate: adminGiftIssueRate });
      setLayoutOrientation(adminLayoutOrientation);
      setShowAdmin(false);
      resetGame(nextInventory);
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
      csvContent += 'STT,Thời gian,Tên người chơi,Tài khoản,Email,Kết quả,Loại\n';

      logs.forEach((log, index) => {
        csvContent += `${index + 1},${log.timestamp},"${log.userName || 'Người chơi'}","${log.accountId || ''}","${log.userEmail || 'Ẩn danh'}","${log.result}",${log.type}\n`;
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
      await setDoc(gameSettingsRef(), {
        layoutOrientation: 'vertical',
        ...DEFAULT_GAME_SETTINGS,
      }, { merge: true });

      const snapshot = await getDocs(collection(db, 'logs'));
      const deletePromises = snapshot.docs.map((itemDoc) => deleteDoc(itemDoc.ref));
      await Promise.all(deletePromises);

      setInventory(DEFAULT_INVENTORY);
      setGameSettings(DEFAULT_GAME_SETTINGS);
      setLayoutOrientation('vertical');
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

  const totalGiftStock = Object.entries(adminInventory)
    .filter(([key]) => key !== 'none')
    .reduce((total, [, item]) => total + Math.max(0, Math.floor(item.count)), 0);
  const hasLuckCalculationInputs = adminTotalCheckins > 0 && totalGiftStock > 0;
  const giftsToIssue = Math.min(
    totalGiftStock,
    Math.floor(totalGiftStock * adminGiftIssueRate / 100),
  );
  const backupGiftCount = Math.max(0, totalGiftStock - giftsToIssue);
  const nextLuckCount = hasLuckCalculationInputs
    ? Math.max(0, adminTotalCheckins - giftsToIssue)
    : adminInventory.none?.count || 0;
  const adminInventoryKeys = [
    ...Object.keys(adminInventory).filter((key) => key !== 'none'),
    ...(adminInventory.none ? ['none'] : []),
  ];
  const displayOrientation: LayoutOrientation = isPhoneViewport ? 'vertical' : layoutOrientation;
  const activeAccountId = accountIdFromAuthEmail(user?.email || null) || accountId || null;
  const accountNumber = accountNumberFromId(activeAccountId);

  const handleAccountLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedAccountId = normalizeAccountId(accountId);

    if (!normalizedAccountId || !accountPassword) {
      setLoginError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }

    setIsSigningIn(true);
    setLoginError(null);

    try {
      await signInWithAccount(normalizedAccountId, accountPassword);
      setAccountPassword('');
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/too-many-requests') {
        setLoginError('Có quá nhiều lần thử. Vui lòng đợi rồi thử lại.');
      } else if (code === 'auth/operation-not-allowed') {
        setLoginError('Firebase chưa bật đăng nhập bằng Email/Password.');
      } else {
        setLoginError('Tài khoản hoặc mật khẩu không đúng.');
      }
    } finally {
      setIsSigningIn(false);
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
      <main className={`flex-grow ${!user
        ? 'flex min-h-[100dvh] w-full items-center justify-center p-6'
        : displayOrientation === 'horizontal'
          ? 'flex flex-col items-center justify-center p-6 md:grid md:grid-cols-2 md:gap-8'
          : 'relative flex min-h-[100dvh] w-full flex-col items-center justify-start px-6 pb-6 pt-20 md:pb-24'
      }`}>
        {!user ? (
          <div className="grid w-full max-w-6xl items-center gap-10 px-6 md:grid-cols-2 md:gap-16">
            <div className="flex items-center justify-center">
              <img
                src="/typo-lat-o-nhan-qua.png"
                alt="LẬT Ô NHẬN QUÀ"
                draggable={false}
                className="h-auto w-full max-w-xl object-contain"
              />
            </div>
            <div className="flex justify-center">
              <div className="w-full max-w-md rounded-3xl border border-red-100 bg-white/95 p-8 text-center shadow-2xl shadow-red-900/10 backdrop-blur-sm md:p-10">
                <div className="relative mx-auto mb-8 w-fit">
                  <img src="/cellphones-logo.png" alt="CellphoneS" className="h-12 w-auto object-contain" draggable={false} />
                  {accountNumber && (
                    <span className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-red-700 text-sm font-black text-white shadow-lg" aria-label={`Tài khoản ${accountNumber}`}>
                      {accountNumber}
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-600">Welcome</p>
                <h1 className="mt-3 text-2xl font-black uppercase text-gray-900 md:text-3xl">Mời đăng nhập</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-500">Đăng nhập để bắt đầu tham gia lật ô nhận quà.</p>
                <form onSubmit={(event) => void handleAccountLogin(event)} className="mt-8 space-y-3 text-left">
                  <label className="block text-xs font-bold uppercase tracking-wide text-gray-600" htmlFor="account-id">
                    Tài khoản vận hành
                  </label>
                  <input
                    id="account-id"
                    type="text"
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value.toUpperCase())}
                    placeholder="Ví dụ: DOORGIFT_1"
                    autoComplete="username"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold uppercase outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                  />
                  <label className="block text-xs font-bold uppercase tracking-wide text-gray-600" htmlFor="account-password">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <input
                      id="account-password"
                      type={showAccountPassword ? 'text' : 'password'}
                      value={accountPassword}
                      onChange={(event) => setAccountPassword(event.target.value)}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-12 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccountPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                      aria-label={showAccountPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      title={showAccountPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showAccountPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {loginError && <p className="text-sm font-semibold text-red-600" role="alert">{loginError}</p>}
                  <button
                    type="submit"
                    disabled={isSigningIn}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-700/20 transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    {isSigningIn ? 'ĐANG ĐĂNG NHẬP...' : 'ĐĂNG NHẬP'}
                  </button>
                </form>
                <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span>Admin</span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  ĐĂNG NHẬP ADMIN BẰNG GOOGLE
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={`text-center ${displayOrientation === 'horizontal'
              ? 'mb-8 md:mb-0 md:w-full md:self-center md:text-center'
              : 'vertical-stage mb-2 w-full max-w-[42rem]'
            }`}>
              <div className="relative mx-auto w-fit">
                <img
                  src="/cellphones-logo.png"
                  alt="CellphoneS"
                  draggable={false}
                  className={displayOrientation === 'horizontal'
                    ? 'mx-auto mb-4 h-10 w-auto object-contain md:h-12'
                    : 'vertical-logo object-contain'
                  }
                />
                {accountNumber && (
                  <span className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-red-700 text-sm font-black text-white shadow-lg" aria-label={`Tài khoản ${accountNumber}`}>
                    {accountNumber}
                  </span>
                )}
              </div>
              <div
                className={`mx-auto w-full select-none ${displayOrientation === 'horizontal' ? 'md:mx-auto' : 'max-w-[42rem]'}`}
                onContextMenu={(event) => event.preventDefault()}
                onDragStart={(event) => event.preventDefault()}
              >
                <img
                  src="/typo-lat-o-nhan-qua.png"
                  alt="LẬT Ô NHẬN QUÀ"
                  draggable={false}
                  className={displayOrientation === 'horizontal'
                    ? 'mx-auto h-auto max-h-56 max-w-full object-contain md:mx-auto md:max-h-[30rem]'
                    : 'mx-auto h-auto w-full object-contain'
                  }
                />
              </div>
            </div>

            <div className={`grid aspect-square w-full grid-cols-3 ${displayOrientation === 'horizontal'
              ? 'max-w-md gap-3 md:w-full md:max-w-3xl md:justify-self-center'
              : 'vertical-stage gap-3 md:gap-5'
            }`}>
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
          </>
        )}
      </main>

      {user && (
        <div className="w-fit self-end mr-4 mb-4 flex items-center gap-2 rounded-full border border-red-100 bg-red-700 p-1.5 text-white shadow-xl shadow-red-900/20 md:fixed md:bottom-4 md:right-4 md:z-40 md:mr-0 md:mb-0">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white/80 bg-white/20" title={user.email || ''}>
            {user.photoURL ? (
              <img src={user.photoURL} alt="Avatar" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-lg font-bold">{accountNumber || user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}</span>
            )}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={toggleAdmin}
              className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-white"
              title="Cài đặt"
              aria-label="Cài đặt"
            >
              <Settings className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void logOut()}
            className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-white"
            title="Đăng xuất"
            aria-label="Đăng xuất"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      )}

      {showAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="relative w-full max-w-lg">
            <div className="bg-white rounded-2xl p-6 w-full shadow-3xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800 uppercase">Cài đặt hệ thống</h2>
                <button onClick={toggleAdmin} className="text-gray-400 transition hover:text-red-600 cursor-pointer md:hidden">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <label className="block text-sm font-bold text-red-700">Bố cục</label>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdminLayoutOrientation('vertical')}
                    className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
                      adminLayoutOrientation === 'vertical'
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-red-200 bg-white text-red-700 hover:bg-red-100'
                    }`}
                  >
                    DỌC
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminLayoutOrientation('horizontal')}
                    className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
                      adminLayoutOrientation === 'horizontal'
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-red-200 bg-white text-red-700 hover:bg-red-100'
                    }`}
                  >
                    NGANG
                  </button>
                </div>
              </div>

              {adminInventoryKeys.map((key) => {
                const item = adminInventory[key];
                const isNone = key === 'none';

                return (
                  <div key={key} className={`relative rounded-xl border p-4 ${isNone ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-100 bg-gray-50'}`}>
                    {!isNone && (
                      <button onClick={() => handleRemoveItem(key)} className="absolute top-2 right-2 text-gray-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gradient-to-b from-slate-50 to-white">
                        {item.img ? (
                          <img src={item.img} alt={item.name} className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-2xl">{item.icon || '🎁'}</span>
                        )}
                      </div>
                      <label className={`block text-sm font-bold uppercase tracking-wider ${isNone ? 'text-emerald-700' : 'text-red-600'}`}>
                        {isNone ? 'CHÚC BẠN MAY MẮN LẦN SAU' : item.name}
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

                      {isNone ? (
                        <div className="md:col-span-2 space-y-4">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Tổng SV check-in</label>
                              <input
                                type="number"
                                value={adminTotalCheckins}
                                onChange={(event) => setAdminTotalCheckins(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
                                min="0"
                                step="1"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Tỷ lệ quà phát ra (%)</label>
                              <input
                                type="number"
                                value={adminGiftIssueRate}
                                onChange={(event) => {
                                  const rate = Number.parseFloat(event.target.value);
                                  setAdminGiftIssueRate(Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0);
                                }}
                                min="0"
                                max="100"
                                step="0.1"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
                            <div className="rounded-lg bg-white px-2 py-3">
                              <div className="text-[10px] font-bold uppercase text-gray-400">Tổng quà</div>
                              <div className="mt-1 text-lg font-bold text-gray-800">{totalGiftStock}</div>
                            </div>
                            <div className="rounded-lg bg-white px-2 py-3">
                              <div className="text-[10px] font-bold uppercase text-gray-400">Quà phát</div>
                              <div className="mt-1 text-lg font-bold text-emerald-700">{giftsToIssue}</div>
                            </div>
                            <div className="rounded-lg bg-white px-2 py-3">
                              <div className="text-[10px] font-bold uppercase text-gray-400">Backup</div>
                              <div className="mt-1 text-lg font-bold text-amber-600">{backupGiftCount}</div>
                            </div>
                            <div className="rounded-lg bg-emerald-100 px-2 py-3">
                              <div className="text-[10px] font-bold uppercase text-emerald-700">May mắn lần sau</div>
                              <div className="mt-1 text-lg font-bold text-emerald-800">{hasLuckCalculationInputs ? nextLuckCount : '—'}</div>
                            </div>
                          </div>

                          <p className="text-xs leading-relaxed text-gray-500">
                            Công thức: <strong>SV check-in − quà phát</strong>. Nhập tổng SV để cập nhật số này.
                          </p>
                        </div>
                      ) : (
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
                      )}

                      {!isNone && item.img && (
                        <button
                          type="button"
                          onClick={() => void handleExistingItemBackgroundRemoval(key)}
                          disabled={isProcessingImage || Boolean(processingExistingItemKey)}
                          className="self-end rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          {processingExistingItemKey === key ? 'ĐANG TÁCH NỀN...' : 'TÁCH NỀN LẠI'}
                        </button>
                      )}

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
                  <div className="md:col-span-2">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">QUÀ MẪU CÓ SẴN</label>
                    <select
                      value={selectedGiftPreset}
                      onChange={(event) => handleGiftPresetChange(event.target.value)}
                      className="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                    >
                      <option value="">-- Chọn quà mẫu để điền nhanh --</option>
                      {COMMON_GIFT_PRESETS.filter(preset => Boolean(preset.img)).map(preset => (
                        <option key={preset.id} value={preset.id}>
                          {preset.icon} {preset.name} · {preset.id}
                        </option>
                      ))}
                    </select>
                  </div>
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
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-2">PREVIEW SAU KHI TÁCH NỀN</label>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-gradient-to-b from-slate-50 to-white ${imageProcessStatus === 'success' ? 'border-green-400' : imageProcessStatus === 'error' ? 'border-red-400' : 'border-gray-300'}`}>
                        {newItem.img ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImage({ src: newItem.img, alt: newItem.name || 'Ảnh quà mới' })}
                            className="h-full w-full cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-inset"
                            aria-label="Xem ảnh quà mới kích thước lớn"
                          >
                            <img src={newItem.img} alt="Xem trước quà mới" className="h-full w-full object-contain" />
                          </button>
                        ) : (
                          <ImagePlus className="h-7 w-7 text-gray-400" />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition ${
                          imageProcessStatus === 'success'
                            ? 'bg-green-600 cursor-pointer hover:bg-green-700'
                            : imageProcessStatus === 'processing'
                              ? 'bg-red-600 cursor-wait opacity-80'
                              : 'bg-red-700 cursor-pointer hover:bg-red-800'
                        }`}>
                          {imageProcessStatus === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
                          {isProcessingImage
                            ? `ĐANG TÁCH NỀN TỰ ĐỘNG ${imageProcessingProgress}%`
                            : imageProcessStatus === 'success'
                              ? 'TÁCH NỀN THÀNH CÔNG'
                              : imageProcessStatus === 'error'
                                ? 'TÁCH NỀN THẤT BẠI - CHỌN LẠI'
                                : 'CHỌN ẢNH'}
                          <input type="file" accept="image/*" onChange={handleNewItemImageChange} disabled={isProcessingImage} className="hidden" />
                        </label>
                        {newItem.img && !isProcessingImage && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewItem(prev => ({ ...prev, img: '' }));
                              setImageProcessStatus('idle');
                            }}
                            className="rounded-lg px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                          >
                            XÓA ẢNH
                          </button>
                        )}
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
                <div className="space-y-3 md:hidden">
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
                </div>
                <button
                  onClick={() => setShowConfirmReset(true)}
                  disabled={isSaving || isResetting}
                  className="w-full bg-red-100 text-red-700 py-3 rounded-lg font-bold hover:bg-red-200 transition cursor-pointer mt-4 disabled:cursor-not-allowed disabled:opacity-60 md:hidden"
                >
                  KHÔI PHỤC DỮ LIỆU GỐC
                </button>
              </div>
            </div>
            <div className="absolute -right-16 top-4 hidden flex-col gap-2 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl md:flex">
              <button
                type="button"
                onClick={toggleAdmin}
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-red-600"
                title="Đóng cài đặt"
                aria-label="Đóng cài đặt"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={saveAdminSettings}
                disabled={isSaving || isResetting}
                className="flex h-11 w-11 items-center justify-center rounded-full text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                title="Lưu thay đổi"
                aria-label="Lưu thay đổi"
              >
                <Save className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={exportLogs}
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
                title="Xuất file nhật ký"
                aria-label="Xuất file nhật ký"
              >
                <Download className="h-5 w-5" />
              </button>
              <div className="my-1 h-px w-8 bg-gray-200" />
              <button
                type="button"
                onClick={() => setShowConfirmReset(true)}
                disabled={isSaving || isResetting}
                className="flex h-11 w-11 items-center justify-center rounded-full text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Khôi phục dữ liệu gốc"
                aria-label="Khôi phục dữ liệu gốc"
              >
                <RotateCcw className="h-5 w-5" />
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

      {previewImage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh kích thước lớn"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center rounded-2xl bg-white p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={previewImage.src}
              alt={previewImage.alt}
              className="max-h-[84vh] max-w-[86vw] object-contain"
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              aria-label="Đóng preview ảnh"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {showResult && currentResultType && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-gradient-to-b from-white via-slate-50 to-white p-6 text-center backdrop-blur-sm">
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
