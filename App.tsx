import React, { useState, useCallback, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, 
  Upload, 
  FileText, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  MapPin,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  Pencil,
  Save,
  JapaneseYen,
  Banknote,
  Bell,
  Navigation,
  Check
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isToday, parseISO, differenceInMinutes, parse, subMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---

export interface Shift {
  id: string;
  date: string; // ISO string
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  role?: string;
  location?: string;
  source: string;
  hourlyWage?: number;
  commuteTime?: number; // in minutes
  rawText?: string;
  isConfirmed: boolean;
}

export interface ExtractionResult {
  shifts: Omit<Shift, "id" | "isConfirmed">[];
  confidence: number;
  notes?: string;
}

// --- Utils & Services ---

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function extractShiftsFromImage(base64Image: string, mimeType: string): Promise<ExtractionResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    この画像からシフト勤務情報を抽出してください。
    日付、開始時間、終了時間、役割（職種）、場所、もし記載があれば時給（hourlyWage）を探してください。
    データを構造化されたJSON形式で返してください。
    複数のシフトがある場合は、すべてリストアップしてください。
    日付は YYYY-MM-DD 形式にしてください。
    時間は HH:mm 形式にしてください。
    時給は数値（Number）として抽出してください。
    年が不明な場合は、現在の年（2026年）と仮定してください。
    sourceには勤務先名やスケジュール元を記載してください。
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Image.split(",")[1] || base64Image,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          shifts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING, description: "YYYY-MM-DD" },
                startTime: { type: Type.STRING, description: "HH:mm" },
                endTime: { type: Type.STRING, description: "HH:mm" },
                role: { type: Type.STRING },
                location: { type: Type.STRING },
                source: { type: Type.STRING, description: "Name of the workplace or schedule source" },
                hourlyWage: { type: Type.NUMBER },
              },
              required: ["date", "startTime", "endTime"],
            },
          },
          confidence: { type: Type.NUMBER },
          notes: { type: Type.STRING },
        },
        required: ["shifts"],
      },
    },
  });

  try {
    const text = response.text || "{}";
    return JSON.parse(text) as ExtractionResult;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    throw new Error("画像の解析に失敗しました。");
  }
}

// --- App Logic ---

const calculateEarnings = (shift: Shift) => {
  if (!shift.hourlyWage) return 0;
  
  const start = parse(shift.startTime, 'HH:mm', new Date());
  let end = parse(shift.endTime, 'HH:mm', new Date());
  
  // Handle night shifts crossing midnight
  if (end < start) {
    end = addMonths(end, 0); // Logic helper, but simpler:
    const diff = (end.getTime() + 24 * 60 * 60 * 1000 - start.getTime()) / (1000 * 60);
    return Math.floor((diff / 60) * shift.hourlyWage);
  }
  
  const diffMinutes = differenceInMinutes(end, start);
  return Math.floor((diffMinutes / 60) * shift.hourlyWage);
};

// --- Components ---

const ShiftCard = ({ shift, onDelete, onConfirm, onEdit }: { shift: Shift; onDelete: (id: string) => void; onConfirm: (id: string) => void; onEdit: (shift: Shift) => void; key?: string }) => {
  const earnings = calculateEarnings(shift);

  const departureTime = shift.commuteTime && shift.startTime 
    ? format(subMinutes(parse(shift.startTime, 'HH:mm', new Date()), shift.commuteTime), 'HH:mm')
    : null;

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "group relative flex flex-col gap-2 p-4 rounded-2xl border transition-all duration-200",
        shift.isConfirmed 
          ? "bg-white border-zinc-200 shadow-sm" 
          : "bg-amber-50/50 border-amber-200 shadow-sm ring-1 ring-amber-100"
      )}
    >
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
            {format(parseISO(shift.date), 'M月d日 (E)', { locale: ja })}
          </span>
          <h3 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            {shift.startTime} – {shift.endTime}
          </h3>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit(shift)}
            className="p-1.5 rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 transition-colors"
            title="編集する"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {!shift.isConfirmed && (
            <button 
              onClick={() => onConfirm(shift.id)}
              className="p-1.5 rounded-full bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"
              title="確定する"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          <button 
            onClick={() => onDelete(shift.id)}
            className="p-1.5 rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200 transition-colors"
            title="削除する"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mt-1">
        {shift.role && (
          <div className="flex items-center gap-1.5 text-sm text-zinc-600">
            <Briefcase className="w-3.5 h-3.5 opacity-60" />
            {shift.role}
          </div>
        )}
        {shift.location && (
          <div className="flex items-center gap-1.5 text-sm text-zinc-600">
            <MapPin className="w-3.5 h-3.5 opacity-60" />
            {shift.location}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
          {shift.source}
        </div>
        {shift.hourlyWage && (
          <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
            <JapaneseYen className="w-3.5 h-3.5" />
            {shift.hourlyWage.toLocaleString()} /時
          </div>
        )}
      </div>

      {departureTime && (
        <div className="mt-2 flex items-center justify-between p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 italic">
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
            <Navigation className="w-4 h-4" />
            出発予定：{departureTime}
          </div>
          <div className="text-[10px] text-indigo-400 font-mono">
            通勤 {shift.commuteTime}分
          </div>
        </div>
      )}

      {earnings > 0 && (
        <div className="mt-2 flex items-center gap-2 p-2 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm">
          <Banknote className="w-4 h-4" />
          見込み：¥{earnings.toLocaleString()}
        </div>
      )}

      {!shift.isConfirmed && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-600">
          <AlertCircle className="w-3 h-3" />
          AIによる未確定の抽出結果
        </div>
      )}
    </motion.div>
  );
};

const CalendarView = ({ shifts, currentMonth, onMonthChange }: { shifts: Shift[]; currentMonth: Date; onMonthChange: (date: Date) => void }) => {
  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  return (
    <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between p-6 border-bottom border-zinc-100">
        <h2 className="text-xl font-bold text-zinc-900">
          {format(currentMonth, 'yyyy年 M月', { locale: ja })}
        </h2>
        <div className="flex gap-2">
          <button 
            onClick={() => onMonthChange(subMonths(currentMonth, 1))}
            className="p-2 rounded-full hover:bg-zinc-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button 
            onClick={() => onMonthChange(addMonths(currentMonth, 1))}
            className="p-2 rounded-full hover:bg-zinc-100 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-t border-zinc-100">
        {['日', '月', '火', '水', '木', '金', '土'].map(day => (
          <div key={day} className="py-3 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-400 border-b border-zinc-100">
            {day}
          </div>
        ))}
        {Array.from({ length: startOfMonth(currentMonth).getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square border-b border-r border-zinc-50 bg-zinc-50/30" />
        ))}
        {days.map(day => {
          const dayShifts = shifts.filter(s => isSameDay(parseISO(s.date), day));
          return (
            <div 
              key={day.toISOString()} 
              className={cn(
                "aspect-square p-2 border-b border-r border-zinc-100 relative group transition-colors",
                isToday(day) ? "bg-indigo-50/30" : "hover:bg-zinc-50/50"
              )}
            >
              <span className={cn(
                "text-xs font-medium",
                isToday(day) ? "text-indigo-600 font-bold" : "text-zinc-500"
              )}>
                {format(day, 'd')}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {dayShifts.map(s => (
                  <div 
                    key={s.id} 
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded-md truncate font-medium",
                      s.isConfirmed ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700"
                    )}
                  >
                    {s.startTime} {s.role || s.source}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const EditShiftModal = ({ shift, onSave, onClose }: { shift: Shift; onSave: (updated: Shift) => void; onClose: () => void }) => {
  const [formData, setFormData] = useState<Shift>({ ...shift });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">シフトを編集</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-zinc-100 transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">日付</label>
            <input 
              type="date" 
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">開始時間</label>
              <input 
                type="time" 
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">終了時間</label>
              <input 
                type="time" 
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">時給 (円)</label>
              <input 
                type="number" 
                placeholder="例: 1200"
                value={formData.hourlyWage || ''}
                onChange={(e) => setFormData({ ...formData, hourlyWage: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">通勤時間 (分)</label>
              <input 
                type="number" 
                placeholder="例: 30"
                value={formData.commuteTime || ''}
                onChange={(e) => setFormData({ ...formData, commuteTime: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">役割 / 職種</label>
            <input 
              type="text" 
              placeholder="例: キッチン, レジ"
              value={formData.role || ''}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">場所</label>
            <input 
              type="text" 
              placeholder="例: 渋谷店"
              value={formData.location || ''}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">勤務先名</label>
            <input 
              type="text" 
              value={formData.source}
              onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="p-6 bg-zinc-50 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl font-bold text-zinc-500 hover:bg-zinc-200 transition-colors"
          >
            キャンセル
          </button>
          <button 
            onClick={() => onSave(formData)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            保存する
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [shifts, setShifts] = useState<Shift[]>(() => {
    const saved = localStorage.getItem('shiftsync_shifts');
    return saved ? JSON.parse(saved) : [];
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [error, setError] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    return 'Notification' in window && Notification.permission === 'granted';
  });
  const [lastNotifiedShift, setLastNotifiedShift] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('shiftsync_shifts', JSON.stringify(shifts));
  }, [shifts]);

  // Notification Check Logic
  useEffect(() => {
    const checkDeparture = () => {
      const now = new Date();
      const todayShifts = shifts.filter(s => isSameDay(parseISO(s.date), now));
      
      for (const shift of todayShifts) {
        if (!shift.commuteTime || !shift.isConfirmed) continue;
        
        const startTimeStr = shift.startTime;
        const shiftStart = parse(startTimeStr, 'HH:mm', now);
        const departureTime = subMinutes(shiftStart, shift.commuteTime);
        
        // Notify if it's within 1 minute of departure time and not already notified
        const diffInSeconds = Math.abs((now.getTime() - departureTime.getTime()) / 1000);
        
        if (diffInSeconds < 60 && lastNotifiedShift !== `${shift.id}-${format(now, 'yyyyMMdd')}`) {
          if (notificationsEnabled) {
            new Notification('バイト出発の時間です', {
              body: `${shift.startTime}からの${shift.source}でのバイトに向け、今すぐ出発しましょう！`,
              icon: '/favicon.ico'
            });
            setLastNotifiedShift(`${shift.id}-${format(now, 'yyyyMMdd')}`);
          }
        }
      }
    };

    const interval = setInterval(checkDeparture, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [shifts, notificationsEnabled, lastNotifiedShift]);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsProcessing(true);
    setError(null);
    
    try {
      for (const file of acceptedFiles) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        
        const base64 = await base64Promise;
        const result = await extractShiftsFromImage(base64, file.type);
        
        const newShifts: Shift[] = result.shifts.map(s => ({
          ...s,
          id: Math.random().toString(36).substr(2, 9),
          isConfirmed: false,
        }));
        
        setShifts(prev => [...prev, ...newShifts]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の解析に失敗しました");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    multiple: true
  } as any);

  const deleteShift = (id: string) => {
    setShifts(prev => prev.filter(s => s.id !== id));
  };

  const confirmShift = (id: string) => {
    setShifts(prev => prev.map(s => s.id === id ? { ...s, isConfirmed: true } : s));
  };

  const saveShift = (updated: Shift) => {
    setShifts(prev => prev.map(s => s.id === updated.id ? { ...updated, isConfirmed: true } : s));
    setEditingShift(null);
  };

  const clearAll = () => {
    if (confirm("すべてのシフトを削除しますか？")) setShifts([]);
  };

  const currentMonthShifts = shifts.filter(s => {
    const d = parseISO(s.date);
    return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
  });

  const totalMonthlyEarnings = currentMonthShifts.reduce((acc, s) => acc + calculateEarnings(s), 0);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <CalendarIcon className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">シフト同期 AI</h1>
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">OCR 統合管理</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {!notificationsEnabled && 'Notification' in window && (
              <button 
                onClick={requestNotificationPermission}
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold hover:bg-amber-200 transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                通知を許可
              </button>
            )}
            {notificationsEnabled && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                <Check className="w-3.5 h-3.5" />
                通知ON
              </div>
            )}
            <div className="flex bg-zinc-100 p-1 rounded-xl">
              <button 
                onClick={() => setView('calendar')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
                  view === 'calendar' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                カレンダー
              </button>
              <button 
                onClick={() => setView('list')}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
                  view === 'list' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                リスト
              </button>
            </div>
            {shifts.length > 0 && (
              <button 
                onClick={clearAll}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-widest"
              >
                すべて削除
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Upload & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">新規スケジュール追加</h2>
            </div>
            
            <div 
              {...getRootProps()} 
              className={cn(
                "relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 p-8 flex flex-col items-center justify-center text-center gap-4",
                isDragActive ? "border-indigo-500 bg-indigo-50/50" : "border-zinc-200 hover:border-zinc-300 bg-white"
              )}
            >
              <input {...getInputProps()} />
              <div className={cn(
                "w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110",
                isDragActive ? "bg-indigo-100 text-indigo-600" : "bg-zinc-100 text-zinc-400"
              )}>
                {isProcessing ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  <Upload className="w-8 h-8" />
                )}
              </div>
              <div>
                <p className="font-bold text-zinc-900">
                  {isProcessing ? "スケジュールを解析中..." : "シフト画像をアップロード"}
                </p>
                <p className="text-sm text-zinc-500 mt-1">
                  画像をドラッグ＆ドロップ、またはクリックして選択
                </p>
              </div>
              
              {isProcessing && (
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  className="absolute bottom-0 left-0 h-1 bg-indigo-500 rounded-full"
                />
              )}
            </div>

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div className="text-sm text-rose-700">
                  <p className="font-bold">解析エラー</p>
                  <p className="opacity-80">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">統計 ({format(currentMonth, 'M月')})</h2>
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 p-6 rounded-3xl border border-indigo-400 shadow-xl shadow-indigo-100 text-white">
                <p className="text-xs font-bold opacity-80 uppercase tracking-widest">月間見込み収益</p>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-sm font-bold text-indigo-200">¥</span>
                  <p className="text-3xl font-black">{totalMonthlyEarnings.toLocaleString()}</p>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest bg-white/10 px-2 py-1 rounded-lg w-fit">
                  <Clock className="w-3 h-3" />
                  {currentMonthShifts.length} シフト
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">合計</p>
                  <p className="text-2xl font-bold text-zinc-900 mt-1">{shifts.length}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">未確定</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">
                    {shifts.filter(s => !s.isConfirmed).length}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Main View */}
        <div className="lg:col-span-8 space-y-6">
          <AnimatePresence mode="wait">
            {view === 'calendar' ? (
              <motion.div
                key="calendar"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <CalendarView 
                  shifts={shifts} 
                  currentMonth={currentMonth} 
                  onMonthChange={setCurrentMonth} 
                />
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {shifts.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-zinc-200 p-12 text-center">
                    <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-8 h-8 text-zinc-300" />
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900">シフトがありません</h3>
                    <p className="text-zinc-500 mt-1">スケジュールをアップロードして開始しましょう</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {shifts
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map(shift => (
                        <ShiftCard 
                          key={shift.id} 
                          shift={shift} 
                          onDelete={deleteShift} 
                          onConfirm={confirmShift} 
                          onEdit={setEditingShift}
                        />
                      ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {editingShift && (
          <EditShiftModal 
            shift={editingShift} 
            onSave={saveShift} 
            onClose={() => setEditingShift(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
