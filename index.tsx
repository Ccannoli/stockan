import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Fix: Add type definition for the experimental BarcodeDetector API to resolve the TypeScript error.
// This browser API is experimental and its type definitions may not be included in default tsconfig libs.
declare class BarcodeDetector {
    constructor(options?: { formats: string[] });
    detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}


// --- TYPES AND INTERFaces ---
interface Product {
  id: string;
  name:string;
  sku: string;
  stock: number;
  price: number;
  expiryDate: string;
  description: string;
  imageUrl?: string;
  vatRate: 5 | 10;
}
interface CreditTransaction {
  id: string;
  date: string;
  type: 'sale' | 'payment' | 'interest_charge' | 'interest_reversal';
  amount: number; // positive for debt increases, negative for payments/reversals
  description: string;
  saleId?: string;
}
interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  ruc: string;
  creditAuthorized: boolean;
  creditLimit: number;
  currentDebt: number;
  creditHistory: CreditTransaction[];
}

interface CompanyInfo {
    name: string;
    address: string;
    ruc: string;
    logoUrl?: string;
}

interface Settings {
    stockThreshold: number;
    expiryThresholdDays: number;
    theme: 'light' | 'dark';
    fontSize: 'small' | 'medium' | 'large';
}

interface CartItem extends Product {
    quantity: number;
}

type PaymentMethod = 'cash' | 'credit' | 'debit' | 'credit_customer';

interface Sale {
    id: string;
    date: string; // ISO string for easier date manipulation
    cart: CartItem[];
    customerId?: string;
    customerName: string;
    customerRuc: string;
    subtotal: number;
    iva10Amount: number;
    iva5Amount: number;
    finalTotal: number;
    documentType: 'invoice' | 'receipt';
    paymentMethod: PaymentMethod;
    username: string;
    sessionId: string;
}

interface Expense {
    id: string;
    date: string; // ISO string
    supplierName: string;
    description: string;
    amount: number;
    username: string;
    sessionId: string;
}

interface OtherIncome {
    id: string;
    date: string; // ISO string
    description: string;
    amount: number;
    paymentMethod: 'cash' | 'credit' | 'debit';
    username: string;
    sessionId: string;
}


interface Notification {
    id: string;
    type: 'stock' | 'expiry' | 'expired';
    icon: string;
    message: string;
}

interface CurrencyRates {
  USD: { sell: number; buy: number };
  BRL: { sell: number; buy: number };
  ARS: { sell: number; buy: number };
}

interface User {
    username: string;
    password: string; // In a real app, this would be a hash
    role: 'admin' | 'cashier';
}

interface CashSession {
    id: string;
    openTime: string;
    initialAmount: number;
    openedBy: string;
    closeTime?: string;
    closingAmount?: number;
    closedBy?: string;
}


type ForeignCurrency = keyof CurrencyRates;
type PaymentCurrency = 'PYG' | ForeignCurrency;

type Page = 'products' | 'sales' | 'customers' | 'company' | 'notifications' | 'settings' | 'currency' | 'accounting' | 'history';

// --- HELPERS ---
const formatCurrency = (amount: number): string => `Gs ${Math.round(amount).toLocaleString('es-PY')}`;

// --- MOCK DATA ---
const initialProducts: Product[] = [
  { id: '1', name: 'Leche Entera', sku: '7501055300104', stock: 50, price: 7500, expiryDate: '2024-12-31', description: 'Leche de vaca pasteurizada, 1 litro.', imageUrl: 'https://via.placeholder.com/300x200.png?text=Leche', vatRate: 10 },
  { id: '2', name: 'Pan de Caja', sku: '7501030467364', stock: 8, price: 12000, expiryDate: '2024-08-15', description: 'Pan blanco grande, ideal para sandwiches.', imageUrl: 'https://via.placeholder.com/300x200.png?text=Pan', vatRate: 10 },
  { id: '3', name: 'Huevo (12 piezas)', sku: '7501030412345', stock: 0, price: 15000, expiryDate: '2024-09-01', description: 'Docena de huevos blancos de gallina.', imageUrl: 'https://via.placeholder.com/300x200.png?text=Huevos', vatRate: 5 },
  { id: '4', name: 'Yogur de Fresa', sku: '1234567890123', stock: 15, price: 5000, expiryDate: '2024-06-01', description: 'Yogur bebible de fresa.', imageUrl: 'https://via.placeholder.com/300x200.png?text=Yogur', vatRate: 5 }
];

const initialCustomers: Customer[] = [
    { id: '1', name: 'Juan Pérez', email: 'juan.perez@example.com', phone: '0981-123-456', ruc: '1234567-8', creditAuthorized: true, creditLimit: 2000000, currentDebt: 550000, creditHistory: [
        { id: 'ct-1', date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), type: 'sale', amount: 550000, description: 'Compra de varios productos', saleId: 'FV-12345' }
    ]},
    { id: '2', name: 'Ana García', email: 'ana.garcia@example.com', phone: '0971-876-543', ruc: '8765432-1', creditAuthorized: false, creditLimit: 0, currentDebt: 0, creditHistory: [] }
];


// --- API INITIALIZATION ---
let ai;
try {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
// Fix: Added missing closing curly brace to the try block.
} catch (error) {
  console.error("Failed to initialize GoogleGenAI:", error);
}


// --- COMPONENTS ---
const UserManagementModal = ({ onClose }) => {
    const { users, addUser, deleteUser } = useData();
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState<'admin' | 'cashier'>('cashier');
    const [error, setError] = useState('');
    const isFirstUser = users.length === 0;

    const handleAddUser = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!newUsername || !newPassword) {
            setError('El nombre de usuario y la contraseña no pueden estar vacíos.');
            return;
        }
        if (users.some(u => u.username === newUsername)) {
            setError('El nombre de usuario ya existe.');
            return;
        }
        
        // The DataProvider will force the first user to be an admin.
        addUser({ username: newUsername, password: newPassword, role: isFirstUser ? 'admin' : newRole });
        setNewUsername('');
        setNewPassword('');
        setNewRole('cashier');
    };

    const handleDeleteUser = (username: string) => {
        if (window.confirm(`¿Estás seguro de que quieres eliminar al usuario "${username}"?`)) {
            deleteUser(username);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Gestionar Usuarios</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                
                <div className="user-management-list">
                    <h3>Usuarios Existentes</h3>
                    <ul>
                        {users.map(user => (
                            <li key={user.username} className="user-management-item">
                                <div className="user-management-info">
                                    <span className="user-management-name">{user.username}</span>
                                    <span className="user-management-role">{user.role}</span>
                                </div>
                                <button
                                    className="btn btn-icon btn-danger-outline"
                                    onClick={() => handleDeleteUser(user.username)}
                                    title={`Eliminar ${user.username}`}
                                >
                                    <span className="material-symbols-outlined">delete</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <form onSubmit={handleAddUser} className="add-user-form">
                    <h3>Añadir Nuevo Usuario</h3>
                    <div className="form-group">
                        <label>Nombre de Usuario</label>
                        <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label>Contraseña</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label>Rol</label>
                        <select value={isFirstUser ? 'admin' : newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'cashier')} disabled={isFirstUser}>
                            <option value="cashier">Cajero</option>
                            <option value="admin">Administrador</option>
                        </select>
                         {isFirstUser && <p className="form-group-description">El primer usuario debe ser un administrador.</p>}
                    </div>
                    {error && <p className="form-error">{error}</p>}
                    <button type="submit" className="btn btn-primary">Añadir Usuario</button>
                </form>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
};

const MasterPasswordModal = ({ onConfirm, onClose }) => {
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(password);
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Contraseña Maestra</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Ingresa la contraseña maestra para continuar</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary">Confirmar</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const LoginPage = () => {
    const { login, users } = useData();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const noUsersExist = users.length === 0;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const success = login(username, password);
        if (!success) {
            setError('Usuario o contraseña incorrectos.');
        }
    };

    const handleConfigClick = () => {
        setIsPasswordModalOpen(true);
    };

    const handlePasswordConfirm = (pass: string) => {
        if (pass === '47448') {
            setIsPasswordModalOpen(false);
            setIsConfigOpen(true);
        } else {
            alert('Contraseña incorrecta.');
            setIsPasswordModalOpen(false);
        }
    };

    return (
        <>
            <div className="login-container">
                <div className="login-card">
                     <div className="sidebar-title login-title">
                        <span className="material-symbols-outlined logo">inventory_2</span>
                        <h1>Stockann</h1>
                    </div>
                     {noUsersExist && (
                        <p className="login-info-message">
                            <strong>¡Bienvenido a Stockann!</strong><br />
                            Para comenzar, es necesario crear un usuario administrador.
                        </p>
                    )}
                    <form onSubmit={handleSubmit}>
                        <fieldset disabled={noUsersExist}>
                            <div className="form-group">
                                <label>Usuario</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label>Contraseña</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                            {error && <p className="login-error">{error}</p>}
                            <button type="submit" className="btn btn-primary btn-full">Iniciar Sesión</button>
                        </fieldset>
                    </form>
                    <button type="button" className="btn-config-users" onClick={handleConfigClick}>
                        <span className="material-symbols-outlined">settings</span>
                        Gestionar Usuarios
                    </button>
                </div>
            </div>
            {isPasswordModalOpen && (
                <MasterPasswordModal
                    onClose={() => setIsPasswordModalOpen(false)}
                    onConfirm={handlePasswordConfirm}
                />
            )}
            {isConfigOpen && <UserManagementModal onClose={() => setIsConfigOpen(false)} />}
        </>
    );
};

const BarcodeScanner = ({ onScan, onClose }) => {
    const videoRef = React.useRef(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let stream;
        let animationFrameId;

        const startScan = async () => {
            if (!('BarcodeDetector' in window)) {
                setError('El detector de código de barras no es compatible con este navegador.');
                return;
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();

                    const barcodeDetector = new BarcodeDetector();
                    const detect = async () => {
                        if (!videoRef.current || videoRef.current.readyState < 2) {
                             animationFrameId = requestAnimationFrame(detect);
                             return;
                        }
                        try {
                            const barcodes = await barcodeDetector.detect(videoRef.current);
                            if (barcodes.length > 0) {
                                onScan(barcodes[0].rawValue);
                            } else {
                                animationFrameId = requestAnimationFrame(detect);
                            }
                        } catch (err) {
                            console.error("Barcode detection failed:", err);
                             animationFrameId = requestAnimationFrame(detect);
                        }
                    };
                    detect();
                }
            } catch (err) {
                console.error("Camera access error:", err);
                setError('No se pudo acceder a la cámara. Por favor, verifica los permisos.');
            }
        };

        startScan();

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [onScan]);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content scanner-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Escanear Código de Barras</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <div className="scanner-video-container">
                    {error ? (
                        <div className="scanner-error">{error}</div>
                    ) : (
                        <video ref={videoRef} className="scanner-video" playsInline></video>
                    )}
                    <div className="scanner-overlay"></div>
                </div>
                 <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                </div>
            </div>
        </div>
    );
};

const Clock = () => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    const formattedTime = time.toLocaleTimeString('es-PY');
    const formattedDate = time.toLocaleDateString('es-PY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <div className="clock-container">
            <p className="clock-time">{formattedTime}</p>
            <p className="clock-date">{formattedDate}</p>
        </div>
    );
};

const SettingsPage = () => {
    const { settings, saveSettings } = useData();
    const [formData, setFormData] = useState(settings);

    useEffect(() => {
        setFormData(settings);
    }, [settings]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        const isNumeric = ['stockThreshold', 'expiryThresholdDays'].includes(name);
        setFormData(prev => ({
            ...prev,
            [name]: isNumeric ? parseInt(value, 10) : value
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        saveSettings(formData);
        alert('Configuración guardada.');
    };

    return (
        <>
            <div className="page-header">
                <h1>Configuración</h1>
            </div>
            <div className="settings-container">
                <form onSubmit={handleSubmit}>
                    <div className="settings-section">
                        <h2>Apariencia</h2>
                        <div className="form-group">
                             <label>Tamaño de la Fuente</label>
                             <p className="form-group-description">Elige el tamaño de texto para la aplicación.</p>
                             <div className="radio-group">
                                <label>
                                    <input type="radio" name="fontSize" value="small" checked={formData.fontSize === 'small'} onChange={handleChange} />
                                    <span>Pequeño</span>
                                </label>
                                <label>
                                    <input type="radio" name="fontSize" value="medium" checked={formData.fontSize === 'medium'} onChange={handleChange} />
                                    <span>Mediano</span>
                                </label>
                                <label>
                                    <input type="radio" name="fontSize" value="large" checked={formData.fontSize === 'large'} onChange={handleChange} />
                                    <span>Grande</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="settings-section">
                        <h2>Notificaciones</h2>
                         <p className="settings-description">
                            Ajusta los umbrales para recibir notificaciones sobre el estado de tu inventario.
                        </p>
                        <div className="form-group">
                            <label htmlFor="stockThreshold">Notificar stock bajo</label>
                            <p className="form-group-description">Recibir una alerta cuando la cantidad de un producto sea igual o inferior a:</p>
                            <input
                                type="number"
                                id="stockThreshold"
                                name="stockThreshold"
                                value={formData.stockThreshold}
                                onChange={handleChange}
                                min="0"
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="expiryThresholdDays">Notificar vencimiento próximo</label>
                            <p className="form-group-description">Recibir una alerta cuando falten los siguientes días (o menos) para el vencimiento:</p>
                            <input
                                 type="number"
                                 id="expiryThresholdDays"
                                 name="expiryThresholdDays"
                                 value={formData.expiryThresholdDays}
                                 onChange={handleChange}
                                 min="0"
                                 required
                            />
                        </div>
                    </div>
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        </>
    );
};

const NotificationsPage = ({ notifications }: { notifications: Notification[] }) => {
    return (
        <>
            <div className="page-header">
                <h1>Centro de Notificaciones</h1>
            </div>
            <div className="notifications-page-container">
                {notifications.length === 0 ? (
                    <div className="no-notifications-card">
                        <span className="material-symbols-outlined icon-extra-large">task_alt</span>
                        <h2>¡Todo en orden!</h2>
                        <p>No tienes notificaciones pendientes.</p>
                    </div>
                ) : (
                    <ul className="notifications-list-page">
                        {notifications.map(n => (
                            <li key={n.id} className={`notification-item type-${n.type}`}>
                                <span className="material-symbols-outlined">{n.icon}</span>
                                <p>{n.message}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
};


const InvoiceModal = ({ isOpen, onClose, saleData, companyInfo }) => {
    if (!isOpen || !saleData) return null;

    const handlePrint = () => {
        window.print();
    };

    const isReceipt = saleData.documentType === 'receipt';

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content invoice-modal-content" onClick={e => e.stopPropagation()}>
                <div className="invoice-container">
                    <div className="modal-header">
                        <h2>{isReceipt ? 'Comprobante de Venta' : 'Factura'}</h2>
                        <button onClick={onClose} className="close-btn">&times;</button>
                    </div>
                    
                    <div className="invoice-header-details">
                        <div className="invoice-company-info">
                            {companyInfo.logoUrl && <img src={companyInfo.logoUrl} alt="Logo de la Empresa" className="invoice-logo" />}
                            <div>
                                <h4>{companyInfo.name}</h4>
                                <p>{companyInfo.address}</p>
                                <p>RUC: {companyInfo.ruc}</p>
                            </div>
                        </div>
                        <div>
                            <p><strong>{isReceipt ? 'Comprobante Nro:' : 'Factura Nro:'}</strong> {saleData.id}</p>
                            <p><strong>Fecha:</strong> {new Date(saleData.date).toLocaleDateString('es-PY')}</p>
                        </div>
                    </div>

                    {!isReceipt && (
                        <div className="invoice-customer-details">
                            <h4>Cliente</h4>
                            <p><strong>Nombre:</strong> {saleData.customerName}</p>
                            <p><strong>RUC:</strong> {saleData.customerRuc}</p>
                        </div>
                    )}


                    <table className="invoice-items-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>IVA</th>
                                <th>Cantidad</th>
                                <th>Precio Unit.</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {saleData.cart.map(item => (
                                <tr key={item.id}>
                                    <td>{item.name}</td>
                                    <td>{item.vatRate}%</td>
                                    <td>{item.quantity}</td>
                                    <td>{formatCurrency(item.price)}</td>
                                    <td>{formatCurrency(item.price * item.quantity)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="invoice-totals">
                        <p><span>Subtotal:</span> <span>{formatCurrency(saleData.subtotal)}</span></p>
                        {saleData.iva10Amount > 0 && <p><span>IVA 10%:</span> <span>{formatCurrency(saleData.iva10Amount)}</span></p>}
                        {saleData.iva5Amount > 0 && <p><span>IVA 5%:</span> <span>{formatCurrency(saleData.iva5Amount)}</span></p>}
                        <p className="total"><span>Total a Pagar:</span> <span>{formatCurrency(saleData.finalTotal)}</span></p>
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
                    <button type="button" className="btn btn-primary" onClick={handlePrint}>
                        <span className="material-symbols-outlined">print</span>
                        Imprimir
                    </button>
                </div>
            </div>
        </div>
    );
};

interface PaymentReceiptData {
    id: string;
    date: string;
    customerName: string;
    customerRuc: string;
    amount: number;
    description: string;
}

const PaymentReceiptModal = ({ isOpen, onClose, paymentData, companyInfo }: {
    isOpen: boolean;
    onClose: () => void;
    paymentData: PaymentReceiptData | null;
    companyInfo: CompanyInfo;
}) => {
    if (!isOpen || !paymentData) return null;

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content invoice-modal-content" onClick={e => e.stopPropagation()}>
                <div className="invoice-container">
                    <div className="modal-header">
                        <h2>Recibo de Pago</h2>
                        <button onClick={onClose} className="close-btn">&times;</button>
                    </div>

                    <div className="invoice-header-details">
                        <div className="invoice-company-info">
                            {companyInfo.logoUrl && <img src={companyInfo.logoUrl} alt="Logo de la Empresa" className="invoice-logo" />}
                            <div>
                                <h4>{companyInfo.name}</h4>
                                <p>{companyInfo.address}</p>
                                <p>RUC: {companyInfo.ruc}</p>
                            </div>
                        </div>
                        <div>
                            <p><strong>Recibo Nro:</strong> {paymentData.id}</p>
                            <p><strong>Fecha:</strong> {new Date(paymentData.date).toLocaleString('es-PY')}</p>
                        </div>
                    </div>

                    <div className="invoice-customer-details">
                        <h4>Recibido de</h4>
                        <p><strong>Nombre:</strong> {paymentData.customerName}</p>
                        <p><strong>RUC:</strong> {paymentData.customerRuc}</p>
                    </div>

                    <table className="invoice-items-table">
                        <thead>
                            <tr>
                                <th>Concepto</th>
                                <th style={{ textAlign: 'right' }}>Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>{paymentData.description}</td>
                                <td style={{ textAlign: 'right' }}>{formatCurrency(paymentData.amount)}</td>
                            </tr>
                        </tbody>
                    </table>

                     <div className="invoice-totals">
                        <p className="total"><span>Total Recibido:</span> <span>{formatCurrency(paymentData.amount)}</span></p>
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
                    <button type="button" className="btn btn-primary" onClick={handlePrint}>
                        <span className="material-symbols-outlined">print</span>
                        Imprimir Recibo
                    </button>
                </div>
            </div>
        </div>
    );
};


const ProductModal = ({ isOpen, onClose, onSave, product }) => {
    const defaultProductState: Omit<Product, 'id'> = { name: '', sku: '', stock: 0, price: 0, expiryDate: '', description: '', imageUrl: '', vatRate: 10 };
    const [formData, setFormData] = useState(product || defaultProductState);
    const [imagePreview, setImagePreview] = useState(product?.imageUrl || null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    useEffect(() => {
        setFormData(product || defaultProductState);
        setImagePreview(product?.imageUrl || null);
    }, [product, isOpen]);
    
    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        const parsedValue = type === 'number' || name === 'vatRate' ? parseInt(value, 10) : value;
        setFormData(prev => ({ ...prev, [name]: parsedValue }));
    };

    const handleImageChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setImagePreview(event.target.result as string);
                setFormData(prev => ({ ...prev, imageUrl: event.target.result as string }));
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({ ...formData, id: product?.id || Date.now().toString() });
        onClose();
    };

    const handleScanSuccess = (scannedSku) => {
        setFormData(prev => ({ ...prev, sku: scannedSku }));
        setIsScannerOpen(false);
    };

    return (
        <>
            <div className="modal-backdrop" onClick={onClose}>
                <div className="modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>{product ? 'Editar' : 'Nuevo'} Producto</h2>
                        <button onClick={onClose} className="close-btn">&times;</button>
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Nombre del Producto</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                        </div>
                         <div className="form-group">
                            <label>Imagen</label>
                            <input type="file" accept="image/*" onChange={handleImageChange} />
                            {imagePreview && <img src={imagePreview} alt="Preview" style={{ maxWidth: '100px', marginTop: '10px' }} />}
                        </div>
                        <div className="form-group">
                            <label>Tipo de IVA</label>
                            <select name="vatRate" value={formData.vatRate} onChange={handleChange} required>
                                <option value={10}>10%</option>
                                <option value={5}>5%</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>SKU (Código de Barras)</label>
                            <div className="input-with-button">
                                <input type="text" name="sku" value={formData.sku} onChange={handleChange} />
                                <button type="button" className="btn btn-icon" onClick={() => setIsScannerOpen(true)} title="Escanear código de barras">
                                    <span className="material-symbols-outlined">barcode_scanner</span>
                                </button>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Cantidad (Stock)</label>
                            <input type="number" name="stock" value={formData.stock} onChange={handleChange} min="0" required />
                        </div>
                        <div className="form-group">
                            <label>Precio (Gs)</label>
                            <input type="number" name="price" value={formData.price} onChange={handleChange} min="0" step="1" required />
                        </div>
                        <div className="form-group">
                            <label>Fecha de Vencimiento</label>
                            <input type="date" name="expiryDate" value={formData.expiryDate} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Descripción</label>
                            <textarea name="description" value={formData.description} onChange={handleChange}></textarea>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                            <button type="submit" className="btn btn-primary">Guardar</button>
                        </div>
                    </form>
                </div>
            </div>
            {isScannerOpen && (
                <BarcodeScanner
                    onScan={handleScanSuccess}
                    onClose={() => setIsScannerOpen(false)}
                />
            )}
        </>
    );
};

const CustomerModal = ({ isOpen, onClose, onSave, customer }) => {
    const defaultState: Omit<Customer, 'id'> = { name: '', email: '', phone: '', ruc: '', creditAuthorized: false, creditLimit: 0, currentDebt: 0, creditHistory: [] };
    const [formData, setFormData] = useState(customer || defaultState);

    useEffect(() => {
        setFormData(customer || defaultState);
    }, [customer, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox') {
            setFormData(prev => ({ ...prev, [name]: checked }));
        } else {
            const isNumeric = ['creditLimit'].includes(name);
            setFormData(prev => ({ ...prev, [name]: isNumeric ? parseInt(value, 10) || 0 : value }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name || !formData.ruc) {
            alert('Nombre y R.U.C. son obligatorios.');
            return;
        }
         const customerDataToSave = {
            ...formData,
            id: customer?.id || Date.now().toString(),
            // Ensure limit is 0 if credit is not authorized
            creditLimit: formData.creditAuthorized ? formData.creditLimit : 0,
        };
        onSave(customerDataToSave);
        onClose();
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{customer ? 'Editar' : 'Nuevo'} Cliente</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Nombre y Apellido</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>R.U.C.</label>
                        <input type="text" name="ruc" value={formData.ruc} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input type="email" name="email" value={formData.email} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label>Teléfono</label>
                        <input type="tel" name="phone" value={formData.phone} onChange={handleChange} />
                    </div>

                    <div className="settings-section">
                        <h3>Gestión de Crédito (Fiado)</h3>
                        <div className="form-group">
                            <label className="checkbox-label">
                                <input 
                                    type="checkbox" 
                                    name="creditAuthorized" 
                                    checked={formData.creditAuthorized} 
                                    onChange={handleChange}
                                />
                                <span>Autorizar Crédito</span>
                            </label>
                        </div>
                        {formData.creditAuthorized && (
                            <div className="form-group">
                                <label>Límite de Crédito (Gs)</label>
                                <input 
                                    type="number" 
                                    name="creditLimit" 
                                    value={formData.creditLimit} 
                                    onChange={handleChange} 
                                    min="0" 
                                    step="100000"
                                />
                            </div>
                        )}
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary">Guardar</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CheckoutModal = ({ isOpen, onClose, cart, customers, onConfirmSale }) => {
    const { currencyRates } = useData();
    const [addIva, setAddIva] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [customerData, setCustomerData] = useState({ name: '', ruc: '' });
    const [amountPaid, setAmountPaid] = useState<number>(0);
    const [documentType, setDocumentType] = useState<'invoice' | 'receipt'>('invoice');
    const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrency>('PYG');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

    const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);

    useEffect(() => {
        if (isOpen) {
            // Reset form on open
            setAddIva(false);
            setCustomerData({ name: '', ruc: '' });
            setSelectedCustomerId('');
            setAmountPaid(0);
            setDocumentType('invoice');
            setPaymentCurrency('PYG');
            setPaymentMethod('cash');
        }
    }, [isOpen]);

    if (!isOpen) return null;
    
    const handleCustomerChange = (e) => {
        const customerId = e.target.value;
        setSelectedCustomerId(customerId);
        const customer = customers.find(c => c.id === customerId);
        if (customer) {
            setCustomerData({ name: customer.name, ruc: customer.ruc });
            // If credit is not the current method, switch to cash by default
            if (paymentMethod === 'credit_customer') {
                setPaymentMethod('cash');
            }
        } else {
            setCustomerData({ name: '', ruc: '' });
        }
    };

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const totalIva10Products = cart
        .filter(item => (item.vatRate || 10) === 10)
        .reduce((sum, item) => sum + item.price * item.quantity, 0);

    const totalIva5Products = cart
        .filter(item => item.vatRate === 5)
        .reduce((sum, item) => sum + item.price * item.quantity, 0);

    const iva10Amount = addIva ? totalIva10Products / 11 : 0;
    const iva5Amount = addIva ? totalIva5Products / 21 : 0;
    const totalIvaAmount = iva10Amount + iva5Amount;
    
    const displaySubtotal = addIva ? total - totalIvaAmount : total;
    const finalTotal = total;

    const amountPaidInPyg = paymentCurrency === 'PYG' 
        ? amountPaid
        : amountPaid * (currencyRates[paymentCurrency]?.sell || 0);
    const change = amountPaidInPyg - finalTotal;

    const totalInUSD = currencyRates.USD.sell > 0 ? finalTotal / currencyRates.USD.sell : 0;
    const totalInBRL = currencyRates.BRL.sell > 0 ? finalTotal / currencyRates.BRL.sell : 0;
    const totalInARS = currencyRates.ARS.sell > 0 ? finalTotal / currencyRates.ARS.sell : 0;

    const canUseCredit = selectedCustomer && selectedCustomer.creditAuthorized && (selectedCustomer.currentDebt + finalTotal <= selectedCustomer.creditLimit);

    const handleConfirm = () => {
        if (documentType === 'invoice' && (!customerData.name || !customerData.ruc)) {
            alert('Para una factura, por favor completa los datos del cliente.');
            return;
        }

        if (paymentMethod === 'credit_customer') {
            if (!selectedCustomer) {
                alert('Debe seleccionar un cliente con crédito autorizado.');
                return;
            }
            if (!canUseCredit) {
                alert('El límite de crédito del cliente es insuficiente para esta compra.');
                return;
            }
        }

        const saleCustomerName = documentType === 'invoice' ? customerData.name : 'Consumidor Final';
        const saleCustomerRuc = documentType === 'invoice' ? customerData.ruc : 'XXX';

        onConfirmSale({
            cart,
            customerId: selectedCustomerId,
            customerName: saleCustomerName,
            customerRuc: saleCustomerRuc,
            subtotal: displaySubtotal,
            iva10Amount,
            iva5Amount,
            finalTotal,
            documentType,
            paymentMethod,
        });
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Facturar Venta</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                
                <div className="form-group">
                    <label>Tipo de Comprobante</label>
                    <div className="radio-group">
                        <label>
                            <input type="radio" value="invoice" checked={documentType === 'invoice'} onChange={() => setDocumentType('invoice')} />
                            <span>Factura</span>
                        </label>
                        <label>
                            <input type="radio" value="receipt" checked={documentType === 'receipt'} onChange={() => setDocumentType('receipt')} />
                            <span>Comprobante de Venta</span>
                        </label>
                    </div>
                </div>

                {documentType === 'invoice' && (
                    <>
                        <div className="form-group">
                            <label>Cliente</label>
                            <select value={selectedCustomerId} onChange={handleCustomerChange}>
                                 <option value="">Consumidor Final / Ingresar manualmente</option>
                                 {customers.map(c => (
                                    <option key={c.id} value={c.id}>{c.name} - {c.ruc}</option>
                                 ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Nombre y Apellido</label>
                            <input type="text" value={customerData.name} onChange={e => setCustomerData(prev => ({...prev, name: e.target.value}))} required />
                        </div>
                        <div className="form-group">
                            <label>R.U.C.</label>
                            <input type="text" value={customerData.ruc} onChange={e => setCustomerData(prev => ({...prev, ruc: e.target.value}))} required />
                        </div>
                    </>
                )}


                <div className="checkout-summary">
                    <h4>Resumen de Compra</h4>
                    <ul className="cart-items-summary">
                        {cart.map(item => (
                            <li key={item.id}>
                                <span>{item.name} (x{item.quantity})</span>
                                <span>{formatCurrency(item.price * item.quantity)}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="financial-details">
                         <div>
                            <label>
                                <input type="checkbox" checked={addIva} onChange={() => setAddIva(!addIva)} />
                                Desglosar IVA
                            </label>
                        </div>
                        <p><span>Subtotal:</span> <span>{formatCurrency(displaySubtotal)}</span></p>
                        {addIva && iva10Amount > 0 && <p><span>IVA 10%:</span> <span>{formatCurrency(iva10Amount)}</span></p>}
                        {addIva && iva5Amount > 0 && <p><span>IVA 5%:</span> <span>{formatCurrency(iva5Amount)}</span></p>}
                        <p className="total"><span>Total a Pagar:</span> <span>{formatCurrency(finalTotal)}</span></p>

                         <div className="alternative-currencies">
                            <p>≈ ${totalInUSD.toFixed(2)} USD</p>
                            <p>≈ R${totalInBRL.toFixed(2)} BRL</p>
                            <p>≈ ${totalInARS.toFixed(2)} ARS</p>
                        </div>

                        <div className="form-group">
                            <label>Método de Pago</label>
                            <div className="radio-group">
                                <label>
                                    <input type="radio" value="cash" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} />
                                    <span className="material-symbols-outlined">payments</span>
                                    Efectivo
                                </label>
                                <label>
                                    <input type="radio" value="credit" checked={paymentMethod === 'credit'} onChange={() => setPaymentMethod('credit')} />
                                    <span className="material-symbols-outlined">credit_card</span>
                                    T. Crédito
                                </label>
                                <label>
                                    <input type="radio" value="debit" checked={paymentMethod === 'debit'} onChange={() => setPaymentMethod('debit')} />
                                    <span className="material-symbols-outlined">credit_card</span>
                                    T. Débito
                                </label>
                                <label style={{ display: (selectedCustomer && selectedCustomer.creditAuthorized) ? 'flex' : 'none' }}>
                                    <input 
                                        type="radio" 
                                        value="credit_customer" 
                                        checked={paymentMethod === 'credit_customer'} 
                                        onChange={() => setPaymentMethod('credit_customer')}
                                        disabled={!canUseCredit}
                                    />
                                    <span className="material-symbols-outlined">person_book</span>
                                    Crédito / Fiado
                                </label>
                            </div>
                             {selectedCustomer && selectedCustomer.creditAuthorized && !canUseCredit && (
                                <p className="form-error" style={{marginTop: '0.5rem'}}>El límite de crédito es insuficiente para esta compra.</p>
                            )}
                        </div>

                        {paymentMethod === 'cash' && (
                            <div className="payment-section">
                                <label>Paga con</label>
                                <div className="payment-input-group">
                                    <input
                                        type="number"
                                        value={amountPaid || ''}
                                        onChange={(e) => setAmountPaid(Number(e.target.value) || 0)}
                                        placeholder="0"
                                        min="0"
                                        step="1000"
                                    />
                                    <select 
                                        className="payment-currency-selector" 
                                        value={paymentCurrency} 
                                        onChange={(e) => {
                                            setPaymentCurrency(e.target.value as PaymentCurrency);
                                            setAmountPaid(0); // Reset amount on currency change
                                        }}
                                    >
                                        <option value="PYG">Gs</option>
                                        <option value="USD">USD</option>
                                        <option value="BRL">BRL</option>
                                        <option value="ARS">ARS</option>
                                    </select>
                                    {paymentCurrency === 'PYG' && (
                                        <>
                                            <button type="button" className="btn btn-outline" onClick={() => setAmountPaid(50000)}>50.000</button>
                                            <button type="button" className="btn btn-outline" onClick={() => setAmountPaid(100000)}>100.000</button>
                                        </>
                                    )}
                                </div>
                                {amountPaid > 0 && amountPaidInPyg >= finalTotal && (
                                    <p className="change">
                                        <span>Vuelto:</span>
                                        <span>{formatCurrency(change)}</span>
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                    <button type="button" className="btn btn-primary" onClick={handleConfirm}>Confirmar Venta</button>
                </div>
            </div>
        </div>
    );
};

const StockStatus = ({ stock }) => {
  const getStatus = () => {
    if (stock === 0) return { className: 'stock-out', text: 'Agotado' };
    if (stock <= 10) return { className: 'stock-low', text: `Bajo (${stock})` };
    return { className: 'stock-ok', text: `En stock (${stock})` };
  };
  const { className, text } = getStatus();
  return <span className={`product-stock ${className}`}>{text}</span>;
};

// Fix: Changed ProductCard to a const with React.FC to explicitly type it as a React component, resolving issues with props validation like the 'key' prop error.
type ProductCardProps = {
    product: Product;
    onEdit: () => void;
    onDelete: () => void;
    isUrgent: boolean;
    isReadOnly: boolean;
};

const ProductCard: React.FC<ProductCardProps> = ({ product, onEdit, onDelete, isUrgent, isReadOnly }) => {
    const cardClasses = `product-card ${isUrgent ? 'product-card--urgent' : ''}`;
    
    return (
        <div className={cardClasses}>
            <div>
                 {isUrgent && (
                    <div className="product-urgent-indicator" title="Producto con atención requerida (bajo stock o próximo a vencer)">
                        <span className="material-symbols-outlined">priority_high</span>
                    </div>
                )}
                <img src={product.imageUrl || 'https://via.placeholder.com/300x200.png?text=Sin+Imagen'} alt={product.name} className="product-image" />
                <div className="product-info">
                    <h3 className="product-name">{product.name}</h3>
                    <p className="product-sku">SKU: {product.sku}</p>
                    <div className="product-details">
                        <StockStatus stock={product.stock} />
                        <span className="product-price">{formatCurrency(product.price)}</span>
                    </div>
                    <p className="product-expiry">Vence: {product.expiryDate}</p>
                </div>
            </div>
            {!isReadOnly && (
                <div className="product-card-actions">
                    <button className="btn btn-icon" onClick={onEdit} title="Editar Producto">
                        <span className="material-symbols-outlined">edit</span>
                    </button>
                    <button className="btn btn-icon btn-danger-outline" onClick={onDelete} title="Eliminar Producto">
                        <span className="material-symbols-outlined">delete</span>
                    </button>
                </div>
            )}
        </div>
    );
};


const ProductsPage = ({ onAddProductClick, onEditProductClick }) => {
    const { products, deleteProduct, settings, currentUser } = useData();
    const [searchQuery, setSearchQuery] = useState('');
    const isAdmin = currentUser?.role === 'admin';

    const getUrgencyScore = useCallback((product: Product): number => {
        let score = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isLowStock = product.stock > 0 && product.stock <= settings.stockThreshold;

        let isNearExpiry = false;
        if (product.expiryDate) {
            try {
                const expiryDate = new Date(product.expiryDate + 'T00:00:00');
                const timeDiff = expiryDate.getTime() - today.getTime();
                const daysUntilExpiry = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
                if (daysUntilExpiry >= 0 && daysUntilExpiry <= settings.expiryThresholdDays) {
                    isNearExpiry = true;
                }
            } catch (e) {
                console.error("Invalid date format for product:", product.name, product.expiryDate);
            }
        }
        
        if (isLowStock) score += 1;
        if (isNearExpiry) score += 1;
        
        return score;
    }, [settings.stockThreshold, settings.expiryThresholdDays]);

    const processedProducts = useMemo(() => {
        const lowercasedQuery = searchQuery.toLowerCase();

        return products
            .filter(p =>
                p.name.toLowerCase().includes(lowercasedQuery) ||
                p.sku.toLowerCase().includes(lowercasedQuery)
            )
            .map(p => ({ ...p, urgencyScore: getUrgencyScore(p) }))
            .sort((a, b) => {
                if (b.urgencyScore !== a.urgencyScore) {
                    return b.urgencyScore - a.urgencyScore;
                }
                return a.name.localeCompare(b.name);
            });
    }, [products, searchQuery, getUrgencyScore]);

    const products10 = processedProducts.filter(p => (p.vatRate || 10) === 10);
    const products5 = processedProducts.filter(p => p.vatRate === 5);

    const handleDelete = (product: Product) => {
        if (window.confirm(`¿Estás seguro de que quieres eliminar "${product.name}"?`)) {
            deleteProduct(product.id);
        }
    };

    return (
        <>
            <div className="page-header">
                <h1>Productos</h1>
                <div className="search-bar">
                    <span className="material-symbols-outlined">search</span>
                    <input
                        type="text"
                        placeholder="Buscar por nombre o SKU..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {isAdmin && (
                    <button className="btn btn-primary" onClick={onAddProductClick}>
                        <span className="material-symbols-outlined">add</span>
                        Añadir Producto
                    </button>
                )}
            </div>
            <div className="product-page-content">
                <div className="product-category-section">
                    <h2>Productos con IVA 10%</h2>
                    <div className="product-grid">
                        {products10.map(p => (
                            <ProductCard
                                key={p.id}
                                product={p}
                                onEdit={() => onEditProductClick(p)}
                                onDelete={() => handleDelete(p)}
                                isUrgent={p.urgencyScore > 0}
                                isReadOnly={!isAdmin}
                            />
                        ))}
                    </div>
                </div>
                 <div className="product-category-section">
                    <h2>Productos con IVA 5%</h2>
                    <div className="product-grid">
                        {products5.map(p => (
                            <ProductCard
                                key={p.id}
                                product={p}
                                onEdit={() => onEditProductClick(p)}
                                onDelete={() => handleDelete(p)}
                                isUrgent={p.urgencyScore > 0}
                                isReadOnly={!isAdmin}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
};

const CustomersPage = ({ onAddCustomerClick, onEditCustomerClick, onManageCreditClick }) => {
    const { customers, deleteCustomer } = useData();

    const handleDelete = (customer: Customer) => {
        if (window.confirm(`¿Estás seguro de que quieres eliminar a ${customer.name}?`)) {
            deleteCustomer(customer.id);
        }
    };

    return (
         <>
            <div className="page-header">
                <h1>Clientes</h1>
                <button className="btn btn-primary" onClick={onAddCustomerClick}>
                    <span className="material-symbols-outlined">add</span>
                    Añadir Cliente
                </button>
            </div>
            <ul className="customer-list">
                {customers.map(c => (
                    <li key={c.id} className="customer-item">
                        <div className="customer-details">
                            <h3>{c.name}</h3>
                            <p className="customer-ruc">RUC: {c.ruc}</p>
                            {c.creditAuthorized && (
                                <div className="customer-credit-info">
                                    <span className="credit-badge">Crédito Habilitado</span>
                                    <p>Deuda: <strong>{formatCurrency(c.currentDebt)}</strong></p>
                                    <p>Límite: {formatCurrency(c.creditLimit)}</p>
                                </div>
                            )}
                            <p className="customer-contact">{c.email || 'N/A'} | {c.phone || 'N/A'}</p>
                        </div>
                        <div className="customer-actions">
                            {c.creditAuthorized && (
                                <button className="btn btn-secondary" onClick={() => onManageCreditClick(c)} title="Gestionar Crédito">
                                    <span className="material-symbols-outlined">credit_score</span>
                                    Gestionar
                                </button>
                            )}
                            <button className="btn btn-icon" onClick={() => onEditCustomerClick(c)} title="Editar Cliente">
                                <span className="material-symbols-outlined">edit</span>
                            </button>
                            <button 
                                className="btn btn-icon btn-danger-outline" 
                                onClick={() => handleDelete(c)} 
                                title="Eliminar Cliente"
                                disabled={c.currentDebt > 0}
                            >
                                <span className="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
};

const CreditManagementModal = ({ isOpen, onClose, customer, onSavePayment, onApplyInterest, onReverseInterest }) => {
    const [paymentAmount, setPaymentAmount] = useState('');
    const [interestPercentage, setInterestPercentage] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'debit'>('cash');

    useEffect(() => {
        if (isOpen) {
            setPaymentAmount('');
            setInterestPercentage('');
            setPaymentMethod('cash');
        }
    }, [isOpen]);
    
    if (!isOpen || !customer) return null;

    const handlePaymentSubmit = (e) => {
        e.preventDefault();
        const amount = Number(paymentAmount);
        if (amount > 0 && amount <= customer.currentDebt) {
            onSavePayment(customer.id, amount, 'Abono a la deuda', paymentMethod);
            setPaymentAmount('');
        } else {
            alert('El monto del pago debe ser mayor que cero y no puede exceder la deuda actual.');
        }
    };

    const handleInterestSubmit = (e) => {
        e.preventDefault();
        const percentage = Number(interestPercentage);
        if (percentage > 0) {
            onApplyInterest(customer.id, percentage);
            setInterestPercentage('');
        } else {
            alert('El porcentaje de mora debe ser mayor que cero.');
        }
    };

    const handleReverseClick = () => {
        if(window.confirm('¿Estás seguro de que quieres revertir el último cargo por mora?')) {
            onReverseInterest(customer.id);
        }
    }

    const lastTransactionIsInterest = customer.creditHistory?.[0]?.type === 'interest_charge';

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content credit-management-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Gestionar Crédito de {customer.name}</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>

                <div className="credit-summary-card">
                    <div>
                        <p>Deuda Actual</p>
                        <span>{formatCurrency(customer.currentDebt)}</span>
                    </div>
                    <div>
                        <p>Límite de Crédito</p>
                        <span>{formatCurrency(customer.creditLimit)}</span>
                    </div>
                    <div>
                        <p>Crédito Disponible</p>
                        <span>{formatCurrency(customer.creditLimit - customer.currentDebt)}</span>
                    </div>
                </div>

                <div className="credit-actions-container">
                    <form onSubmit={handlePaymentSubmit} className="credit-action-form">
                        <h3>Registrar Pago</h3>
                        <div className="form-group">
                            <label>Monto a Pagar (Gs)</label>
                            <input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} required min="1" max={customer.currentDebt} />
                        </div>
                        <div className="form-group">
                            <label>Método de Pago</label>
                            <div className="radio-group">
                                <label>
                                    <input type="radio" value="cash" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} />
                                    <span className="material-symbols-outlined">payments</span>
                                    Efectivo
                                </label>
                                <label>
                                    <input type="radio" value="credit" checked={paymentMethod === 'credit'} onChange={() => setPaymentMethod('credit')} />
                                    <span className="material-symbols-outlined">credit_card</span>
                                    T. Crédito
                                </label>
                                <label>
                                    <input type="radio" value="debit" checked={paymentMethod === 'debit'} onChange={() => setPaymentMethod('debit')} />
                                    <span className="material-symbols-outlined">credit_card</span>
                                    T. Débito
                                </label>
                            </div>
                        </div>
                        <button type="submit" className="btn btn-primary">Registrar Pago</button>
                    </form>
                    <form onSubmit={handleInterestSubmit} className="credit-action-form">
                        <h3>Aplicar Mora</h3>
                        <div className="form-group">
                            <label>Porcentaje de Mora (%)</label>
                            <input type="number" value={interestPercentage} onChange={e => setInterestPercentage(e.target.value)} required min="0.1" step="0.1" />
                        </div>
                        <button type="submit" className="btn btn-secondary">Aplicar Mora</button>
                        <button type="button" className="btn btn-danger-outline btn-small" onClick={handleReverseClick} disabled={!lastTransactionIsInterest}>
                            <span className="material-symbols-outlined">undo</span> Revertir Última Mora
                        </button>
                    </form>
                </div>

                <div className="transaction-history">
                    <h3>Historial de Movimientos</h3>
                     <div className="table-container">
                        <table className="transaction-history-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Tipo</th>
                                    <th>Descripción</th>
                                    <th>Monto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {customer.creditHistory.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" style={{textAlign: 'center'}}>No hay movimientos en el historial.</td>
                                    </tr>
                                ) : (
                                    customer.creditHistory.map(t => (
                                        <tr key={t.id}>
                                            <td>{new Date(t.date).toLocaleDateString('es-PY')}</td>
                                            <td>{t.type.replace('_', ' ')}</td>
                                            <td>{t.description}</td>
                                            <td className={t.amount >= 0 ? 'debt' : 'payment'}>{formatCurrency(t.amount)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
};

const CompanyPage = () => {
    const { companyInfo, saveCompanyInfo } = useData();
    const [formData, setFormData] = useState(companyInfo);

    useEffect(() => {
        setFormData(companyInfo);
    }, [companyInfo]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setFormData(prev => ({ ...prev, logoUrl: event.target.result as string }));
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        saveCompanyInfo(formData);
        alert('Información de la empresa guardada.');
    };

    return (
        <>
            <div className="page-header">
                <h1>Información de la Empresa</h1>
            </div>
            <div className="company-info-container">
                <form onSubmit={handleSubmit}>
                    <div className="form-group logo-upload-group">
                        <label>Logo de la Empresa</label>
                         <div className="logo-preview-container">
                            {formData.logoUrl ? (
                                <img src={formData.logoUrl} alt="Logo Preview" className="logo-preview" />
                            ) : (
                                <div className="logo-placeholder">
                                    <span className="material-symbols-outlined">image</span>
                                    <span>Subir Logo</span>
                                </div>
                            )}
                            <input type="file" accept="image/png" onChange={handleLogoChange} className="logo-file-input"/>
                        </div>
                        <p className="form-group-description">Sube una imagen PNG para el logo de tu empresa.</p>
                    </div>
                    <div className="form-group">
                        <label>Nombre de la Empresa</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>Dirección</label>
                        <input type="text" name="address" value={formData.address} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>R.U.C.</label>
                        <input type="text" name="ruc" value={formData.ruc} onChange={handleChange} required />
                    </div>
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        </>
    );
};

const SalesPage = () => {
    const { products, customers, finalizeSale, companyInfo, activeCashSessionId } = useData();
    const [cart, setCart] = useState<CartItem[]>([]);
    const [skuInput, setSkuInput] = useState('');
    const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [lastSaleData, setLastSaleData] = useState<Sale | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    useEffect(() => {
        if (lastSaleData) {
            setIsInvoiceModalOpen(true);
        }
    }, [lastSaleData]);

    const addProductToCart = (sku: string) => {
        const product = products.find(p => p.sku === sku);
        if (!product) {
            alert('Producto no encontrado.');
            return;
        }

        const existingItem = cart.find(item => item.id === product.id);

        if (existingItem) {
            if (existingItem.quantity < product.stock) {
                setCart(currentCart =>
                    currentCart.map(item =>
                        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
                    )
                );
            } else {
                alert('No hay más stock disponible para este producto.');
            }
        } else {
            if (product.stock > 0) {
                setCart(currentCart => [...currentCart, { ...product, quantity: 1 }]);
            } else {
                alert('Producto agotado.');
            }
        }
        setSkuInput('');
    };

    const updateCartItemQuantity = (productId: string, newQuantity: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        if (newQuantity > product.stock) {
            alert(`No hay suficiente stock. Disponible: ${product.stock}`);
            setCart(currentCart =>
                currentCart.map(item =>
                    item.id === productId ? { ...item, quantity: product.stock } : item
                )
            );
            return;
        }

        if (newQuantity <= 0) {
            setCart(currentCart => currentCart.filter(item => item.id !== productId));
        } else {
            setCart(currentCart =>
                currentCart.map(item =>
                    item.id === productId ? { ...item, quantity: newQuantity } : item
                )
            );
        }
    };

    const handleSkuSubmit = (e) => {
        e.preventDefault();
        if (skuInput) {
            addProductToCart(skuInput);
        }
    };
    
    const handleScanClick = () => {
        setIsScannerOpen(true);
    };

    const handleScanSuccess = (scannedSku: string) => {
        addProductToCart(scannedSku);
        setIsScannerOpen(false);
    };

    const handleConfirmSale = (saleDataFromCheckout) => {
        const recordedSale = finalizeSale(saleDataFromCheckout);
        setCart([]);
        setIsCheckoutModalOpen(false);
        setLastSaleData(recordedSale);
    };
    
    const handleCloseInvoice = () => {
        setIsInvoiceModalOpen(false);
        setLastSaleData(null);
    };

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return (
        <>
            <div className="page-header">
                <h1>Terminal de Venta</h1>
            </div>
             {!activeCashSessionId && (
                <div className="no-notifications-card">
                    <span className="material-symbols-outlined icon-extra-large" style={{color: 'var(--warning-color)'}}>point_of_sale</span>
                    <h2>Caja Cerrada</h2>
                    <p>Es necesario abrir una caja en la página de Contabilidad para registrar nuevas ventas.</p>
                </div>
            )}
            <div className="pos-container" style={{ filter: !activeCashSessionId ? 'blur(4px)' : 'none', pointerEvents: !activeCashSessionId ? 'none' : 'auto' }}>
                <div className="scanner-section">
                    <h2>Escanear Producto</h2>
                    <form onSubmit={handleSkuSubmit} className="scanner-controls">
                        <input 
                            type="text" 
                            className="form-control"
                            placeholder="Ingresa o escanea el código de barras"
                            value={skuInput}
                            onChange={(e) => setSkuInput(e.target.value)}
                        />
                        <button type="submit" className="btn btn-primary">Añadir</button>
                    </form>
                    <button className="btn btn-secondary" onClick={handleScanClick}>
                        <span className="material-symbols-outlined">barcode_scanner</span>
                        Escanear con Cámara
                    </button>
                </div>
                <div className="cart-section">
                    <h2>Carrito de Compra</h2>
                     <ul className="cart-items">
                        {cart.length === 0 && <p className="empty-cart-message">El carrito está vacío.</p>}
                        {cart.map(item => (
                            <li key={item.id} className="cart-item">
                                <div className="cart-item-info">
                                    <span className="cart-item-name">{item.name}</span>
                                    <span className="cart-item-price">{formatCurrency(item.price)}</span>
                                </div>
                                <div className="cart-item-controls">
                                    <button
                                        className="btn-quantity"
                                        onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)}
                                        aria-label={`Disminuir cantidad de ${item.name}`}
                                    >
                                        -
                                    </button>
                                    <input
                                        type="number"
                                        className="quantity-input"
                                        value={item.quantity}
                                        onChange={(e) => updateCartItemQuantity(item.id, parseInt(e.target.value, 10) || 0)}
                                        onBlur={(e) => { if(!e.target.value) updateCartItemQuantity(item.id, 1)}}
                                        aria-label={`Cantidad de ${item.name}`}
                                    />
                                    <button
                                        className="btn-quantity"
                                        onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)}
                                        aria-label={`Aumentar cantidad de ${item.name}`}
                                    >
                                        +
                                    </button>
                                    <button className="btn-remove-item" onClick={() => updateCartItemQuantity(item.id, 0)} title="Eliminar del carrito">
                                        <span className="material-symbols-outlined">delete</span>
                                    </button>
                                </div>
                                <span className="cart-item-subtotal">{formatCurrency(item.price * item.quantity)}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="cart-summary">
                        <div className="cart-total">
                           <span>Total:</span>
                           <span>{formatCurrency(total)}</span>
                        </div>
                        <button className="btn btn-primary btn-full" disabled={cart.length === 0} onClick={() => setIsCheckoutModalOpen(true)}>Facturar</button>
                    </div>
                </div>
            </div>
             <CheckoutModal
                isOpen={isCheckoutModalOpen}
                onClose={() => setIsCheckoutModalOpen(false)}
                cart={cart}
                customers={customers}
                onConfirmSale={handleConfirmSale}
            />
            {isScannerOpen && (
                <BarcodeScanner
                    onScan={handleScanSuccess}
                    onClose={() => setIsScannerOpen(false)}
                />
            )}
            <InvoiceModal
                isOpen={isInvoiceModalOpen}
                onClose={handleCloseInvoice}
                saleData={lastSaleData}
                companyInfo={companyInfo}
            />
        </>
    );
};

const CurrencyExchangePage = () => {
    const { currencyRates, saveCurrencyRates } = useData();
    // Fix: Explicitly type the `useState` hook for `localRates`. When `currencyRates` is inferred as `any` from the
    // untyped context, `localRates` also becomes `any`. This explicit typing ensures `localRates` has the
    // correct `CurrencyRates` type, which allows `keyof typeof` to work correctly and resolves the downstream errors.
    const [localRates, setLocalRates] = useState<CurrencyRates>(currencyRates);
    const [amount, setAmount] = useState<number>(1);
    const [fromCurrency, setFromCurrency] = useState<'USD' | 'BRL' | 'ARS'>('USD');

    useEffect(() => {
        setLocalRates(currencyRates);
    }, [currencyRates]);

    const handleRateChange = (currency: 'USD' | 'BRL' | 'ARS', type: 'buy' | 'sell', value: string) => {
        setLocalRates(prev => ({
            ...prev,
            [currency]: { ...prev[currency], [type]: Number(value) || 0 }
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        saveCurrencyRates(localRates);
        alert('Cotizaciones guardadas.');
    };

    const rateMeta = {
        USD: { name: 'Dólar Americano', flag: '🇺🇸' },
        BRL: { name: 'Real Brasileño', flag: '🇧🇷' },
        ARS: { name: 'Peso Argentino', flag: '🇦🇷' },
    };
    
    const convertedAmount = amount * (currencyRates[fromCurrency]?.sell || 0);

    return (
        <>
            <div className="page-header">
                <h1>Cotización de Monedas</h1>
            </div>
            <div className="currency-page-container">
                 <form onSubmit={handleSubmit} className="currency-rates-form-card">
                    <h2>Establecer Cotizaciones</h2>
                    <p className="form-description">
                        Ingresa los valores de compra y venta para cada moneda. Estos valores se guardarán y se usarán en la aplicación.
                    </p>
                    <div className="currency-rates-grid">
                        {/* Fix: Iterate over `rateMeta` keys for stronger type safety, as its shape is known at compile time. */}
                        {(Object.keys(rateMeta) as Array<keyof typeof rateMeta>).map((currencyKey) => (
                            <div className="currency-rate-group" key={currencyKey}>
                                <h3>{rateMeta[currencyKey].name} <span className="currency-flag">{rateMeta[currencyKey].flag}</span></h3>
                                <div className="rate-inputs">
                                    <div className="form-group">
                                        <label>Compra (Gs)</label>
                                        <input
                                            type="number"
                                            value={localRates[currencyKey].buy}
                                            onChange={(e) => handleRateChange(currencyKey, 'buy', e.target.value)}
                                            placeholder="0"
                                            min="0"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Venta (Gs)</label>
                                        <input
                                            type="number"
                                            value={localRates[currencyKey].sell}
                                            onChange={(e) => handleRateChange(currencyKey, 'sell', e.target.value)}
                                            placeholder="0"
                                            min="0"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Guardar Cotizaciones</button>
                    </div>
                </form>

                <div className="currency-converter-card">
                    <h2>Calculadora de Cambio</h2>
                    <div className="converter-controls">
                        <div className="form-group">
                            <label>Moneda de Origen</label>
                            <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value as 'USD' | 'BRL' | 'ARS')}>
                                <option value="USD">Dólar Americano (USD)</option>
                                <option value="BRL">Real Brasileño (BRL)</option>
                                <option value="ARS">Peso Argentino (ARS)</option>
                            </select>
                        </div>
                         <div className="form-group">
                            <label>Monto ({fromCurrency})</label>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                                min="0"
                            />
                        </div>
                    </div>
                    <div className="converter-result">
                        <p>Equivalente en Guaraníes (PYG) - (Tasa Venta)</p>
                        <h3>{formatCurrency(convertedAmount)}</h3>
                    </div>
                </div>
            </div>
        </>
    );
};

const InitialCashModal = ({ isOpen, onClose, onSave }) => {
    const [amount, setAmount] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAmount('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(Number(amount) || 0);
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Abrir Caja</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="initialCash">Monto Inicial en Caja (Gs)</label>
                        <input
                            type="number"
                            id="initialCash"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            min="0"
                            step="1000"
                            required
                            autoFocus
                        />
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary">Confirmar Apertura</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CloseCashModal = ({ isOpen, onClose, onSave, expectedAmount }) => {
    const [countedAmount, setCountedAmount] = useState('');
    const difference = (Number(countedAmount) || 0) - expectedAmount;

    useEffect(() => {
        if (isOpen) {
            setCountedAmount('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(Number(countedAmount) || 0);
    };

    const getDifferenceClass = () => {
        if (difference === 0 || !countedAmount) return '';
        return difference > 0 ? 'difference-surplus' : 'difference-shortage';
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Cierre de Caja</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="cash-summary">
                        <p><span>Monto esperado en caja:</span> <span>{formatCurrency(expectedAmount)}</span></p>
                    </div>
                    <div className="form-group">
                        <label htmlFor="countedCash">Monto contado en caja (Gs)</label>
                        <input
                            type="number"
                            id="countedCash"
                            value={countedAmount}
                            onChange={(e) => setCountedAmount(e.target.value)}
                            placeholder="0"
                            min="0"
                            step="1000"
                            required
                            autoFocus
                        />
                    </div>
                    {countedAmount && (
                         <div className={`cash-summary difference-summary ${getDifferenceClass()}`}>
                            <p><span>Diferencia:</span> <span>{formatCurrency(difference)}</span></p>
                         </div>
                    )}
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary">Confirmar Cierre</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ExpenseModal = ({ isOpen, onClose, onSave }) => {
    const [supplierName, setSupplierName] = useState('');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Reset form on open
            setSupplierName('');
            setDescription('');
            setAmount('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const numericAmount = Number(amount);
        if (!supplierName || numericAmount <= 0) {
            alert('Por favor, completa el nombre del proveedor y un monto válido.');
            return;
        }
        onSave({ supplierName, description, amount: numericAmount });
        onClose();
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Registrar Gasto o Pago</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Proveedor / Beneficiario</label>
                        <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label>Descripción</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej: Pago de factura, compra de insumos..."></textarea>
                    </div>
                    <div className="form-group">
                        <label>Monto Pagado (Gs)</label>
                        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required min="1" step="1" />
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                        <button type="submit" className="btn btn-primary">Guardar Gasto</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const AccountingPage = () => {
    const { salesHistory, dailyCashBalances, saveInitialCash, saveClosingCash, expenses, otherIncomes, addExpense, activeCashSessionId } = useData();
    const today = new Date().toISOString().split('T')[0];
    const [currentDate, setCurrentDate] = useState(today);
    const [isCashModalOpen, setIsCashModalOpen] = useState(false);
    const [isCloseCashModalOpen, setIsCloseCashModalOpen] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [sessionToClose, setSessionToClose] = useState<CashSession | null>(null);

    const sessionsForDay = (dailyCashBalances[currentDate] || []).sort((a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime());
    const activeSession = sessionsForDay.find(s => !s.closeTime);

    const handleSaveInitialCash = (amount: number) => {
        saveInitialCash(currentDate, amount);
        setIsCashModalOpen(false);
    };
    
    const handleSaveClosingCash = (amount: number) => {
        if (sessionToClose) {
            saveClosingCash(currentDate, sessionToClose.id, amount);
        }
        setIsCloseCashModalOpen(false);
        setSessionToClose(null);
    };

    const handleSaveExpense = (expenseData) => {
        addExpense(expenseData);
        setIsExpenseModalOpen(false);
    };
    
    const handleCloseSessionClick = (session: CashSession) => {
        setSessionToClose(session);
        setIsCloseCashModalOpen(true);
    };

    const paymentMethodText = (method: PaymentMethod) => {
        switch (method) {
            case 'cash': return 'Efectivo';
            case 'credit': return 'T. Crédito';
            case 'debit': return 'T. Débito';
            case 'credit_customer': return 'Crédito Cliente';
            default: return 'Efectivo'; // Fallback for old data
        }
    };
    
    const getSessionTotals = (sessionId: string) => {
        const sessionSales = salesHistory.filter(s => s.sessionId === sessionId);
        const sessionExpenses = expenses.filter(e => e.sessionId === sessionId);
        const sessionOtherIncomes = otherIncomes.filter(i => i.sessionId === sessionId);
        
        const totalCashRevenue = sessionSales
            .filter(sale => sale.paymentMethod === 'cash' || !sale.paymentMethod)
            .reduce((sum, sale) => sum + sale.finalTotal, 0);

        const totalExpenses = sessionExpenses.reduce((sum, expense) => sum + expense.amount, 0);

        const totalOtherCashIncomes = sessionOtherIncomes
            .filter(income => income.paymentMethod === 'cash')
            .reduce((sum, income) => sum + income.amount, 0);

        return { sessionSales, sessionExpenses, totalCashRevenue, totalExpenses, totalOtherCashIncomes };
    };
    
    const allSalesForDay = salesHistory.filter(sale => new Date(sale.date).toISOString().split('T')[0] === currentDate);
    const allExpensesForDay = expenses.filter(expense => new Date(expense.date).toISOString().split('T')[0] === currentDate);
    const allOtherIncomesForDay = otherIncomes.filter(income => new Date(income.date).toISOString().split('T')[0] === currentDate);


    return (
        <>
            <div className="page-header">
                <h1>Caja y Contabilidad</h1>
            </div>
            <div className="accounting-page-container">
                <div className="date-filter-form">
                    <div className="form-group">
                        <label>Seleccionar Fecha</label>
                        <input type="date" value={currentDate} onChange={e => setCurrentDate(e.target.value)} />
                    </div>
                    <div className="header-actions">
                        <button className="btn btn-secondary" onClick={() => setIsExpenseModalOpen(true)} disabled={!activeCashSessionId}>
                            <span className="material-symbols-outlined">add</span>
                            Registrar Gasto
                        </button>
                         <button className="btn btn-primary" onClick={() => setIsCashModalOpen(true)} disabled={!!activeSession}>
                            <span className="material-symbols-outlined">add_card</span>
                            Abrir Nueva Caja
                        </button>
                    </div>
                </div>

                {sessionsForDay.length === 0 ? (
                     <div className="no-notifications-card">
                        <span className="material-symbols-outlined icon-extra-large">inbox</span>
                        <h2>Sin Sesiones de Caja</h2>
                        <p>No se ha abierto ninguna caja para el día seleccionado.</p>
                    </div>
                ) : (
                    <div className="sessions-list">
                    {sessionsForDay.map((session, index) => {
                        const { sessionSales, sessionExpenses, totalCashRevenue, totalExpenses, totalOtherCashIncomes } = getSessionTotals(session.id);
                        const expectedInRegister = session.initialAmount + totalCashRevenue + totalOtherCashIncomes - totalExpenses;
                        const difference = session.closingAmount !== undefined ? session.closingAmount - expectedInRegister : 0;
                        const isSessionActive = session.id === activeCashSessionId;
                        
                        return(
                        <div key={session.id} className={`session-card ${isSessionActive ? 'session-active' : 'session-closed'}`}>
                            <div className="session-header">
                                <h3>
                                    Sesión de Caja #{sessionsForDay.length - index}
                                    <span className="session-status">{isSessionActive ? 'Activa' : 'Cerrada'}</span>
                                </h3>
                                <div className="session-time">
                                    Abierta a las {new Date(session.openTime).toLocaleTimeString('es-PY')} por {session.openedBy}
                                    {session.closeTime && ` - Cerrada a las ${new Date(session.closeTime).toLocaleTimeString('es-PY')} por ${session.closedBy}`}
                                </div>
                                {!isSessionActive && 
                                <button className="btn btn-icon" title="Modificar cierre (próximamente)" disabled>
                                    <span className="material-symbols-outlined">edit</span>
                                </button>
                                }
                                {isSessionActive &&
                                     <button className="btn btn-danger" onClick={() => handleCloseSessionClick(session)}>
                                       <span className="material-symbols-outlined">lock</span>
                                       Cerrar Caja
                                    </button>
                                }
                            </div>
                            <div className="summary-cards-grid">
                                <div className="summary-card">
                                    <p className="summary-card-title">Caja Inicial</p>
                                    <p className="summary-card-value">{formatCurrency(session.initialAmount)}</p>
                                </div>
                                 <div className="summary-card">
                                    <p className="summary-card-title">Ventas en Efectivo</p>
                                    <p className="summary-card-value">{formatCurrency(totalCashRevenue)}</p>
                                </div>
                                 <div className="summary-card">
                                    <p className="summary-card-title">Otros Ingresos (Efectivo)</p>
                                    <p className="summary-card-value">{formatCurrency(totalOtherCashIncomes)}</p>
                                </div>
                                <div className="summary-card">
                                    <p className="summary-card-title">Total Gastos y Pagos</p>
                                    <p className="summary-card-value" style={{ color: 'var(--danger-color)' }}>-{formatCurrency(totalExpenses)}</p>
                                </div>
                                <div className={`summary-card ${isSessionActive ? 'total-in-register-card':''}`}>
                                    <p className="summary-card-title">Total Esperado en Caja</p>
                                    <p className="summary-card-value">{formatCurrency(expectedInRegister)}</p>
                                </div>
                                {!isSessionActive && (
                                     <div className="summary-card">
                                        <p className="summary-card-title">Caja Cerrada con</p>
                                        <p className="summary-card-value">{formatCurrency(session.closingAmount!)}</p>
                                        {difference !== 0 && (
                                            <p className={`summary-card-difference ${difference > 0 ? 'difference-surplus-text' : 'difference-shortage-text'}`}>
                                                {difference > 0 ? 'Sobrante' : 'Faltante'}: {formatCurrency(Math.abs(difference))}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        )
                    })}
                    </div>
                )}
                
                {(allSalesForDay.length > 0 || allExpensesForDay.length > 0 || allOtherIncomesForDay.length > 0) && (
                    <>
                        <div className="data-table-card">
                            <h2>Detalle de Ventas del Día</h2>
                             {allSalesForDay.length > 0 ? (
                                <table className="accounting-table">
                                    <thead>
                                        <tr>
                                            <th>Hora</th>
                                            <th>Comprobante</th>
                                            <th>Cliente</th>
                                            <th>Vendedor</th>
                                            <th>Método de Pago</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allSalesForDay.map(sale => (
                                            <tr key={sale.id}>
                                                <td>{new Date(sale.date).toLocaleTimeString('es-PY')}</td>
                                                <td>{sale.id} ({sale.documentType === 'invoice' ? 'Factura' : 'Comprobante'})</td>
                                                <td>{sale.customerName}</td>
                                                <td>{sale.username}</td>
                                                <td>{paymentMethodText(sale.paymentMethod)}</td>
                                                <td>{formatCurrency(sale.finalTotal)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : <p>No se encontraron ventas para el día seleccionado.</p>}
                        </div>

                         <div className="data-table-card">
                            <h2>Detalle de Gastos y Pagos del Día</h2>
                            {allExpensesForDay.length > 0 ? (
                                <table className="accounting-table">
                                    <thead>
                                        <tr>
                                            <th>Hora</th>
                                            <th>Proveedor / Beneficiario</th>
                                            <th>Descripción</th>
                                            <th>Registrado por</th>
                                            <th>Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allExpensesForDay.map(expense => (
                                            <tr key={expense.id}>
                                                <td>{new Date(expense.date).toLocaleTimeString('es-PY')}</td>
                                                <td>{expense.supplierName}</td>
                                                <td>{expense.description}</td>
                                                <td>{expense.username}</td>
                                                <td>{formatCurrency(expense.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                             ) : <p>No se encontraron gastos para el día seleccionado.</p>}
                        </div>

                         <div className="data-table-card">
                            <h2>Detalle de Otros Ingresos del Día</h2>
                            {allOtherIncomesForDay.length > 0 ? (
                                <table className="accounting-table">
                                    <thead>
                                        <tr>
                                            <th>Hora</th>
                                            <th>Descripción</th>
                                            <th>Registrado por</th>
                                            <th>Método de Pago</th>
                                            <th>Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allOtherIncomesForDay.map(income => (
                                            <tr key={income.id}>
                                                <td>{new Date(income.date).toLocaleTimeString('es-PY')}</td>
                                                <td>{income.description}</td>
                                                <td>{income.username}</td>
                                                <td>{paymentMethodText(income.paymentMethod)}</td>
                                                <td>{formatCurrency(income.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : <p>No se encontraron otros ingresos para el día seleccionado.</p>}
                        </div>
                    </>
                )}
            </div>
            <InitialCashModal
                isOpen={isCashModalOpen}
                onClose={() => setIsCashModalOpen(false)}
                onSave={handleSaveInitialCash}
            />
            <CloseCashModal
                isOpen={isCloseCashModalOpen}
                onClose={() => setIsCloseCashModalOpen(false)}
                onSave={handleSaveClosingCash}
                expectedAmount={sessionToClose ? (sessionToClose.initialAmount + getSessionTotals(sessionToClose.id).totalCashRevenue + getSessionTotals(sessionToClose.id).totalOtherCashIncomes - getSessionTotals(sessionToClose.id).totalExpenses) : 0}
            />
            <ExpenseModal 
                isOpen={isExpenseModalOpen}
                onClose={() => setIsExpenseModalOpen(false)}
                onSave={handleSaveExpense}
            />
        </>
    );
};

const SalesChart = ({ data, labels }) => {
    if (!data || data.length === 0) {
        return <div className="chart-placeholder">No hay datos de ventas para mostrar en este período.</div>;
    }

    const maxValue = Math.max(...data);
    const chartHeight = 250;
    const barWidth = 35;
    const barMargin = 15;
    const svgWidth = (barWidth + barMargin) * data.length - barMargin;
    
    // Simple currency formatter for axis
    const formatAxisLabel = (value) => {
        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `${Math.round(value / 1000)}k`;
        return value;
    }

    const yAxisLabels = [0, maxValue / 2, maxValue];

    return (
        <div className="chart-container">
            <svg viewBox={`0 0 ${svgWidth} ${chartHeight + 40}`} preserveAspectRatio="xMidYMax meet" aria-label="Gráfico de ventas">
                {/* Y-Axis Labels and Grid Lines */}
                {yAxisLabels.map((value, i) => {
                     const y = chartHeight - (value / maxValue) * chartHeight;
                     return (
                         <g key={i} className="y-axis-group">
                            <text x="-10" y={y} textAnchor="end" alignmentBaseline="middle">{formatAxisLabel(value)}</text>
                            <line x1="0" x2={svgWidth} y1={y} y2={y} className="grid-line" />
                         </g>
                     )
                })}


                {/* Bars and X-Axis Labels */}
                {data.map((value, i) => {
                    const barHeight = (value / maxValue) * chartHeight;
                    const x = i * (barWidth + barMargin);
                    const y = chartHeight - barHeight;

                    return (
                        <g key={i}>
                            <title>{`${labels[i]}: ${formatCurrency(value)}`}</title>
                            <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                className="chart-bar"
                            />
                             <text
                                x={x + barWidth / 2}
                                y={chartHeight + 20}
                                textAnchor="middle"
                                className="chart-label"
                            >
                                {labels[i]}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

const SalesHistoryPage = () => {
    const { salesHistory } = useData();
    const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    
    const {
        totalRevenue,
        totalSales,
        averageTicket,
        growthPercentage,
        chartData,
        chartLabels,
        topProducts
    } = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let startDate, previousStartDate, numIntervals, intervalUnit;

        switch(period) {
            case 'weekly':
                startDate = new Date(today);
                startDate.setDate(today.getDate() - 27); // Last 4 weeks
                previousStartDate = new Date(startDate);
                previousStartDate.setDate(startDate.getDate() - 28);
                numIntervals = 4;
                intervalUnit = 'week';
                break;
            case 'monthly':
                startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1); // Last 6 months
                previousStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 6, 1);
                numIntervals = 6;
                intervalUnit = 'month';
                break;
            case 'daily':
            default:
                startDate = new Date(today);
                startDate.setDate(today.getDate() - 6); // Last 7 days
                previousStartDate = new Date(startDate);
                previousStartDate.setDate(startDate.getDate() - 7);
                numIntervals = 7;
                intervalUnit = 'day';
                break;
        }

        const salesInPeriod = salesHistory.filter(s => new Date(s.date) >= startDate);
        const salesInPreviousPeriod = salesHistory.filter(s => {
            const saleDate = new Date(s.date);
            return saleDate >= previousStartDate && saleDate < startDate;
        });

        // Calculate metrics for current period
// Fix: Explicitly type the accumulator in the reduce function to prevent type inference issues that cause arithmetic operation errors.
        const totalRevenue = salesInPeriod.reduce((sum: number, s) => sum + s.finalTotal, 0);
        const totalSales = salesInPeriod.length;
        const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
        
        // Calculate growth
// Fix: Explicitly type the accumulator in the reduce function to prevent type inference issues that cause arithmetic operation errors.
        const previousRevenue = salesInPreviousPeriod.reduce((sum: number, s) => sum + s.finalTotal, 0);
        const growthPercentage = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : totalRevenue > 0 ? 100 : 0;

        // Process data for chart
        const chartDataMap = new Map();
        const chartLabels = [];

        for(let i=0; i<numIntervals; i++) {
            let key, label;
            if (intervalUnit === 'day') {
                const date = new Date(startDate);
                date.setDate(startDate.getDate() + i);
                key = date.toISOString().split('T')[0];
                label = date.toLocaleDateString('es-PY', { weekday: 'short' });
            } else if (intervalUnit === 'week') {
                const weekStartDate = new Date(startDate);
                weekStartDate.setDate(startDate.getDate() + i * 7);
// Fix: Use .getTime() for Date subtraction to ensure the operation is performed on numbers, resolving the arithmetic type error.
                key = `${weekStartDate.getFullYear()}-W${Math.ceil(((weekStartDate.getTime() - new Date(weekStartDate.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)}`;
                label = `Sem ${i+1}`;
            } else { // month
                const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                label = date.toLocaleDateString('es-PY', { month: 'short' });
            }
            chartDataMap.set(key, 0);
            chartLabels.push(label);
        }
        
        salesInPeriod.forEach(s => {
            const saleDate = new Date(s.date);
            let key;
            if (intervalUnit === 'day') {
                key = saleDate.toISOString().split('T')[0];
            } else if (intervalUnit === 'week') {
// Fix: Use .getTime() for Date subtraction to ensure the operation is performed on numbers, resolving the arithmetic type error.
                key = `${saleDate.getFullYear()}-W${Math.ceil(((saleDate.getTime() - new Date(saleDate.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)}`;
            } else { // month
                key = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
            }
             if (chartDataMap.has(key)) {
                chartDataMap.set(key, chartDataMap.get(key) + s.finalTotal);
            }
        });
        
        const chartData = Array.from(chartDataMap.values());

        // Process top products
// Fix: Explicitly type the accumulator in the reduce function to ensure type safety and prevent downstream errors when rendering the result.
        const productSales = salesInPeriod.flatMap(s => s.cart)
                                          .reduce((acc, item) => {
                                            acc[item.name] = { quantity: (acc[item.name]?.quantity || 0) + item.quantity };
                                            return acc;
                                          }, {} as Record<string, { quantity: number }>);

// Fix: Explicitly type the sort callback parameters and use array indexing to resolve a type inference issue with the subtraction operation.
        const topProducts = Object.entries(productSales)
                                  .sort(([, a], [, b]) => b.quantity - a.quantity)
                                  .slice(0, 5)
                                  .map(([name, { quantity }]) => [name, quantity]);

        return { totalRevenue, totalSales, averageTicket, growthPercentage, chartData, chartLabels, topProducts };

    }, [salesHistory, period]);

    const getGrowthIndicator = () => {
        if (growthPercentage === 0) {
            return <span className="growth-indicator neutral">0%</span>;
        }
        const isPositive = growthPercentage > 0;
        return (
            <span className={`growth-indicator ${isPositive ? 'positive' : 'negative'}`}>
                <span className="material-symbols-outlined">
                    {isPositive ? 'arrow_upward' : 'arrow_downward'}
                </span>
                {Math.abs(growthPercentage).toFixed(1)}%
            </span>
        );
    };

    return (
        <>
            <div className="page-header">
                <h1>Historial y Análisis de Ventas</h1>
            </div>
             <div className="sales-history-container">
                <div className="period-selector">
                    <button onClick={() => setPeriod('daily')} className={period === 'daily' ? 'active' : ''}>Diario</button>
                    <button onClick={() => setPeriod('weekly')} className={period === 'weekly' ? 'active' : ''}>Semanal</button>
                    <button onClick={() => setPeriod('monthly')} className={period === 'monthly' ? 'active' : ''}>Mensual</button>
                </div>

                <div className="summary-cards-grid analytics-grid">
                    <div className="summary-card">
                        <p className="summary-card-title">Ingresos Totales</p>
                        <p className="summary-card-value">{formatCurrency(totalRevenue)}</p>
                    </div>
                    <div className="summary-card">
                        <p className="summary-card-title">Cantidad de Ventas</p>
                        <p className="summary-card-value">{totalSales}</p>
                    </div>
                     <div className="summary-card">
                        <p className="summary-card-title">Ticket Promedio</p>
                        <p className="summary-card-value">{formatCurrency(averageTicket)}</p>
                    </div>
                    <div className="summary-card">
                        <p className="summary-card-title">Crecimiento vs Periodo Ant.</p>
                        <p className="summary-card-value">{getGrowthIndicator()}</p>
                    </div>
                </div>

                <div className="analytics-main-content">
                    <div className="data-table-card chart-card">
                        <h2>Evolución de Ingresos</h2>
                        <SalesChart data={chartData} labels={chartLabels} />
                    </div>
                    <div className="data-table-card top-products-card">
                        <h2>Productos Más Vendidos</h2>
                        {topProducts.length > 0 ? (
                            <ul className="top-products-list">
                                {topProducts.map(([name, quantity]) => (
                                    <li key={name as string}>
                                        <span className="top-product-name">{name}</span>
                                        <span className="top-product-quantity">{quantity} unidades</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No hay suficientes datos de productos vendidos en este período.</p>
                        )}
                    </div>
                </div>
             </div>
        </>
    );
};

const NavButton = ({ icon, label, isActive, onClick, badgeCount = 0 }) => (
    <li className="nav-item">
        <button className={isActive ? 'active' : ''} onClick={onClick}>
            <div className="nav-button-content">
                <span className="material-symbols-outlined">{icon}</span>
                {label}
            </div>
            {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
        </button>
    </li>
);

// --- DATA CONTEXT ---
// Fix: Defined a type for the data context and updated the useData hook. This provides strong typing for the shared state and resolves type inference issues in consuming components.
interface DataContextType {
    products: Product[];
    customers: Customer[];
    companyInfo: CompanyInfo;
    settings: Settings;
    currencyRates: CurrencyRates;
    salesHistory: Sale[];
    expenses: Expense[];
    otherIncomes: OtherIncome[];
    dailyCashBalances: Record<string, CashSession[]>;
    currentUser: User | null;
    users: User[];
    activeCashSessionId: string | null;
    saveProduct: (product: Product) => void;
    deleteProduct: (productId: string) => void;
    saveCustomer: (customer: Customer) => void;
    deleteCustomer: (customerId: string) => void;
    finalizeSale: (saleData: Omit<Sale, 'id' | 'date' | 'username' | 'sessionId'>) => Sale;
    addExpense: (expenseData: Omit<Expense, 'id' | 'date' | 'username' | 'sessionId'>) => void;
    saveCompanyInfo: (info: CompanyInfo) => void;
    saveSettings: (newSettings: Settings) => void;
    saveCurrencyRates: (newRates: CurrencyRates) => void;
    saveInitialCash: (date: string, amount: number) => void;
    saveClosingCash: (date: string, sessionId: string, amount: number) => void;
    login: (username: string, password: string) => boolean;
    logout: () => void;
    addUser: (user: User) => void;
    deleteUser: (username: string) => void;
    registerCustomerPayment: (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'credit' | 'debit') => CreditTransaction | null;
    applyCustomerInterest: (customerId: string, percentage: number) => void;
    reverseLastInterest: (customerId: string) => void;
}

const DataContext = React.createContext<DataContextType | null>(null);
const useData = () => React.useContext(DataContext)!;

// Fix: Changed DataProvider to a const with React.FC to explicitly type it as a React component, which can help TypeScript better infer props like 'children'.
type DataProviderProps = {
    children: React.ReactNode;
};

const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
    const [products, setProducts] = useState<Product[]>(initialProducts);
    const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
    const [salesHistory, setSalesHistory] = useState<Sale[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [otherIncomes, setOtherIncomes] = useState<OtherIncome[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [activeCashSessionId, setActiveCashSessionId] = useState<string | null>(null);
    const [users, setUsers] = useState<User[]>(() => {
        try {
            const savedUsers = localStorage.getItem('appUsers');
            return savedUsers ? JSON.parse(savedUsers) : [];
        } catch (error) {
            console.error("Failed to load users from localStorage", error);
            return [];
        }
    });
    
    useEffect(() => {
        try {
            localStorage.setItem('appUsers', JSON.stringify(users));
        } catch (error) {
            console.error("Failed to save users to localStorage", error);
        }
    }, [users]);
    
    const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
        name: 'Stockann S.A.',
        address: 'Av. Principal 123, Asunción',
        ruc: '80012345-6',
        logoUrl: ''
    });
    const [settings, setSettings] = useState<Settings>(() => {
        try {
            const savedSettings = localStorage.getItem('appSettings');
            const defaults: Settings = {
                stockThreshold: 10,
                expiryThresholdDays: 10,
                theme: 'light',
                fontSize: 'small'
            };
            if (savedSettings) {
                const parsed = JSON.parse(savedSettings);
                return { ...defaults, ...parsed };
            }
            return defaults;
        } catch (error) {
            console.error("Failed to load settings from localStorage", error);
            return {
                stockThreshold: 10,
                expiryThresholdDays: 10,
                theme: 'light',
                fontSize: 'small'
            };
        }
    });
    const [currencyRates, setCurrencyRates] = useState<CurrencyRates>({
        USD: { sell: 7550, buy: 7450 },
        BRL: { sell: 1450, buy: 1350 },
        ARS: { sell: 8, buy: 6 },
    });
    const [dailyCashBalances, setDailyCashBalances] = useState<Record<string, CashSession[]>>({});

    useEffect(() => {
        if (currentUser) {
            const today = new Date().toISOString().split('T')[0];
            const todaysSessions = dailyCashBalances[today] || [];
            const openSession = todaysSessions.find(s => !s.closeTime);
            setActiveCashSessionId(openSession ? openSession.id : null);
        } else {
            setActiveCashSessionId(null);
        }
    }, [dailyCashBalances, currentUser]);


    const saveProduct = (product: Product) => {
        setProducts(prev => {
            const exists = prev.some(p => p.id === product.id);
            if (exists) {
                return prev.map(p => p.id === product.id ? product : p);
            }
            return [...prev, product];
        });
    };
    
    const deleteProduct = (productId: string) => {
        setProducts(prev => prev.filter(p => p.id !== productId));
    };

    const saveCustomer = (customer: Customer) => {
        setCustomers(prev => {
            const exists = prev.some(c => c.id === customer.id);
            if (exists) {
                return prev.map(c => c.id === customer.id ? customer : c);
            }
            return [...prev, customer];
        });
    };

    const deleteCustomer = (customerId: string) => {
        const customer = customers.find(c => c.id === customerId);
        if (customer && customer.currentDebt > 0) {
            alert('No se puede eliminar un cliente con deuda pendiente.');
            return;
        }
        setCustomers(prev => prev.filter(c => c.id !== customerId));
    };

    const updateCustomerDebt = (customerId: string, amount: number, transaction: Omit<CreditTransaction, 'id'|'date'>) => {
        setCustomers(prevCustomers => prevCustomers.map(c => {
            if (c.id === customerId) {
                const newTransaction: CreditTransaction = {
                    ...transaction,
                    id: `ct-${Date.now()}`,
                    date: new Date().toISOString(),
                };
                return {
                    ...c,
                    currentDebt: c.currentDebt + amount,
                    creditHistory: [newTransaction, ...c.creditHistory]
                }
            }
            return c;
        }));
    };

    const registerCustomerPayment = (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'credit' | 'debit'): CreditTransaction | null => {
        let createdTransaction: CreditTransaction | null = null;
        const customer = customers.find(c => c.id === customerId);

        if (!customer) return null;

        setCustomers(prevCustomers => {
            const newCustomers = prevCustomers.map(c => {
                if (c.id === customerId) {
                    const newTransaction: CreditTransaction = {
                        id: `RCP-${Date.now().toString().slice(-6)}`,
                        date: new Date().toISOString(),
                        type: 'payment',
                        amount: -amount,
                        description: description || 'Abono a la deuda',
                    };
                    createdTransaction = newTransaction;
                    return {
                        ...c,
                        currentDebt: c.currentDebt - amount,
                        creditHistory: [newTransaction, ...c.creditHistory]
                    }
                }
                return c;
            });
            return newCustomers;
        });
        
        if (paymentMethod === 'cash' && currentUser && activeCashSessionId) {
            const newIncome: OtherIncome = {
                id: `INC-${Date.now().toString().slice(-6)}`,
                date: new Date().toISOString(),
                description: `Cobro de crédito a ${customer.name}`,
                amount: amount,
                paymentMethod: 'cash',
                username: currentUser.username,
                sessionId: activeCashSessionId,
            };
            setOtherIncomes(prev => [...prev, newIncome]);
        }

        return createdTransaction;
    };

    const applyCustomerInterest = (customerId: string, percentage: number) => {
        const customer = customers.find(c => c.id === customerId);
        if (customer && customer.currentDebt > 0) {
            const interestAmount = Math.round(customer.currentDebt * (percentage / 100));
            updateCustomerDebt(customerId, interestAmount, {
                type: 'interest_charge',
                amount: interestAmount,
                description: `Mora del ${percentage}% sobre ${formatCurrency(customer.currentDebt)}`
            });
        }
    };

    const reverseLastInterest = (customerId: string) => {
        const customer = customers.find(c => c.id === customerId);
        if (customer && customer.creditHistory.length > 0) {
            const lastTransaction = customer.creditHistory[0];
            if (lastTransaction.type === 'interest_charge') {
                 setCustomers(prevCustomers => prevCustomers.map(c => {
                    if (c.id === customerId) {
                        const newTransaction: CreditTransaction = {
                            id: `ct-${Date.now()}`,
                            date: new Date().toISOString(),
                            type: 'interest_reversal',
                            amount: -lastTransaction.amount,
                            description: `Reversión de mora aplicada el ${new Date(lastTransaction.date).toLocaleDateString('es-PY')}`
                        };
                        return {
                            ...c,
                            currentDebt: c.currentDebt - lastTransaction.amount,
                            creditHistory: [newTransaction, ...c.creditHistory]
                        };
                    }
                    return c;
                }));
            } else {
                alert('La última transacción no fue un cargo por mora.');
            }
        }
    };
    
    const saveCompanyInfo = (info: CompanyInfo) => {
        setCompanyInfo(info);
    };

    const saveSettings = (newSettings: Settings) => {
        setSettings(newSettings);
        try {
            localStorage.setItem('appSettings', JSON.stringify(newSettings));
        } catch (error) {
            console.error("Failed to save settings to localStorage", error);
        }
    };

    const saveCurrencyRates = (newRates: CurrencyRates) => {
        setCurrencyRates(newRates);
    };

    const saveInitialCash = (date: string, amount: number) => {
        if (!currentUser) return;
        const sessionsForDay = dailyCashBalances[date] || [];
        if (sessionsForDay.some(s => !s.closeTime)) {
            alert("Ya existe una caja abierta para este día. Ciérrala antes de abrir una nueva.");
            return;
        }

        const newSession: CashSession = {
            id: `SESS-${Date.now()}`,
            openTime: new Date().toISOString(),
            initialAmount: amount,
            openedBy: currentUser.username,
        };

        setDailyCashBalances(prev => ({
            ...prev,
            [date]: [...sessionsForDay, newSession]
        }));
    };

    const saveClosingCash = (date: string, sessionId: string, amount: number) => {
        if (!currentUser) return;
        setDailyCashBalances(prev => {
            const sessionsForDay = prev[date] || [];
            const updatedSessions = sessionsForDay.map(s => {
                if (s.id === sessionId) {
                    return {
                        ...s,
                        closingAmount: amount,
                        closeTime: new Date().toISOString(),
                        closedBy: currentUser.username
                    };
                }
                return s;
            });
            return { ...prev, [date]: updatedSessions };
        });
    };
    
    const finalizeSale = (saleData: Omit<Sale, 'id' | 'date' | 'username' | 'sessionId'>): Sale => {
        if (!currentUser || !activeCashSessionId) {
            alert("Error: No hay una sesión de caja activa. No se puede registrar la venta.");
            throw new Error("Cannot finalize sale without an active cash session.");
        }
        const newSale: Sale = {
            ...saleData,
            id: `FV-${Date.now().toString().slice(-6)}`,
            date: new Date().toISOString(),
            username: currentUser.username,
            sessionId: activeCashSessionId,
        };

        setProducts(currentProducts => {
            const newProducts = [...currentProducts];
            newSale.cart.forEach(cartItem => {
                const productIndex = newProducts.findIndex(p => p.id === cartItem.id);
                if (productIndex !== -1) {
                    newProducts[productIndex] = {
                        ...newProducts[productIndex],
                        stock: newProducts[productIndex].stock - cartItem.quantity
                    };
                }
            });
            return newProducts;
        });

        if (newSale.paymentMethod === 'credit_customer' && newSale.customerId) {
            const customer = customers.find(c => c.id === newSale.customerId);
            if (customer) {
                updateCustomerDebt(customer.id, newSale.finalTotal, {
                    type: 'sale',
                    amount: newSale.finalTotal,
                    description: `Venta - Comprobante ${newSale.id}`,
                    saleId: newSale.id
                });
            }
        }

        setSalesHistory(prev => [...prev, newSale]);
        return newSale;
    };
    
    const addExpense = (expenseData: Omit<Expense, 'id' | 'date' | 'username' | 'sessionId'>) => {
         if (!currentUser || !activeCashSessionId) {
            alert("Error: No hay una sesión de caja activa. No se puede registrar el gasto.");
            throw new Error("Cannot add expense without an active cash session.");
        }
        const newExpense: Expense = {
            ...expenseData,
            id: `EXP-${Date.now().toString().slice(-6)}`,
            date: new Date().toISOString(),
            username: currentUser.username,
            sessionId: activeCashSessionId,
        };
        setExpenses(prev => [...prev, newExpense]);
    };

    const login = (username: string, password: string): boolean => {
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            setCurrentUser(user);
            return true;
        }
        return false;
    };

    const logout = () => {
        setCurrentUser(null);
    };

    const addUser = (user: User) => {
        setUsers(prev => {
            const finalUser = prev.length === 0 ? { ...user, role: 'admin' as const } : user;
            return [...prev, finalUser];
        });
    };
    
    const deleteUser = (username: string) => {
        setUsers(prev => {
            const userToDelete = prev.find(u => u.username === username);
            if (!userToDelete) return prev;

            const isAdmin = userToDelete.role === 'admin';
            const adminCount = prev.filter(u => u.role === 'admin').length;

            if (isAdmin && adminCount <= 1) {
                alert('No se puede eliminar al último administrador.');
                return prev;
            }
            return prev.filter(u => u.username !== username);
        });
    };

    const value = { products, customers, companyInfo, settings, currencyRates, salesHistory, expenses, otherIncomes, dailyCashBalances, currentUser, users, activeCashSessionId, saveProduct, deleteProduct, saveCustomer, deleteCustomer, finalizeSale, addExpense, saveCompanyInfo, saveSettings, saveCurrencyRates, saveInitialCash, saveClosingCash, login, logout, addUser, deleteUser, registerCustomerPayment, applyCustomerInterest, reverseLastInterest };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
}


// --- MAIN APP COMPONENT ---
const App = () => {
  const { currentUser } = useData();
  
  if (!currentUser) {
    return <LoginPage />;
  }
  
  return <MainApp />;
};

const MainApp = () => {
  const { products, customers, saveProduct, saveCustomer, settings, saveSettings, companyInfo, currentUser, logout, registerCustomerPayment, applyCustomerInterest, reverseLastInterest } = useData();
  const defaultPage: Page = currentUser?.role === 'admin' ? 'accounting' : 'sales';
  const [page, setPage] = useState<Page>(defaultPage);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [managingCreditCustomer, setManagingCreditCustomer] = useState<Customer | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isPaymentReceiptModalOpen, setIsPaymentReceiptModalOpen] = useState(false);
  const [lastPaymentData, setLastPaymentData] = useState<PaymentReceiptData | null>(null);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
        document.documentElement.setAttribute('data-font-size', settings.fontSize);
    }, [settings]);

    const toggleTheme = () => {
        const newTheme = settings.theme === 'light' ? 'dark' : 'light';
        saveSettings({ ...settings, theme: newTheme });
    };

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeNotifications: Notification[] = [];

    products.forEach(product => {
        // Low Stock Check
        if (product.stock > 0 && product.stock <= settings.stockThreshold) {
            activeNotifications.push({
                id: `stock-${product.id}`,
                type: 'stock',
                icon: 'warning',
                message: `${product.name} tiene bajo stock (${product.stock}).`,
            });
        }

        // Expiry Check
        if (product.expiryDate) {
            try {
                const expiryDate = new Date(product.expiryDate + 'T00:00:00'); // Use T00:00:00 to avoid timezone issues
                const timeDiff = expiryDate.getTime() - today.getTime();
                const daysUntilExpiry = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

                if (daysUntilExpiry < 0) {
                     activeNotifications.push({
                        id: `expired-${product.id}`,
                        type: 'expired',
                        icon: 'error',
                        message: `${product.name} está vencido.`,
                    });
                } else if (daysUntilExpiry >= 0 && daysUntilExpiry <= settings.expiryThresholdDays) {
                     activeNotifications.push({
                        id: `expiry-${product.id}`,
                        type: 'expiry',
                        icon: 'event_busy',
                        message: `${product.name} vence en ${daysUntilExpiry} ${daysUntilExpiry === 1 ? 'día' : 'días'}.`,
                    });
                }
            } catch(e) { console.error("Invalid date format for product:", product.name, product.expiryDate) }
        }
    });

    setNotifications(activeNotifications);
  }, [products, settings]);


  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setIsProductModalOpen(true);
  };

  const handleAddProduct = () => {
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setIsCustomerModalOpen(true);
  };

  const handleAddCustomer = () => {
    setEditingCustomer(null);
    setIsCustomerModalOpen(true);
  };

  const handleManageCredit = (customer: Customer) => {
    setManagingCreditCustomer(customer);
    setIsCreditModalOpen(true);
  };

  const handleSavePayment = (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'credit' | 'debit') => {
    const transaction = registerCustomerPayment(customerId, amount, description, paymentMethod);
    const customer = customers.find(c => c.id === customerId);

    if (transaction && customer) {
        setLastPaymentData({
            id: transaction.id,
            date: transaction.date,
            customerName: customer.name,
            customerRuc: customer.ruc,
            amount: amount,
            description: transaction.description,
        });
        setIsPaymentReceiptModalOpen(true);
    }
  };

  const renderPage = () => {
    switch (page) {
      case 'products': return <ProductsPage onAddProductClick={handleAddProduct} onEditProductClick={handleEditProduct} />;
      case 'sales': return <SalesPage />;
      case 'customers': return <CustomersPage onAddCustomerClick={handleAddCustomer} onEditCustomerClick={handleEditCustomer} onManageCreditClick={handleManageCredit} />;
      case 'accounting': return <AccountingPage />;
      case 'history': return <SalesHistoryPage />;
      case 'company': return <CompanyPage />;
      case 'settings': return <SettingsPage />;
      case 'notifications': return <NotificationsPage notifications={notifications} />;
      case 'currency': return <CurrencyExchangePage />;
      default: return <SalesPage />;
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="app-container">
      <nav className="sidebar">
          <div className="sidebar-header">
               {companyInfo.logoUrl ? (
                  <img src={companyInfo.logoUrl} alt="Logo de la Empresa" className="sidebar-logo" />
              ) : (
                  <div className="sidebar-title">
                    <span className="material-symbols-outlined logo">inventory_2</span>
                    Stockann
                  </div>
              )}
          </div>
        <div className="sidebar-nav-wrapper">
            <ul className="nav-list">
              <NavButton icon="point_of_sale" label="Ventas" isActive={page === 'sales'} onClick={() => setPage('sales')} />
              <NavButton icon="inventory" label="Productos" isActive={page === 'products'} onClick={() => setPage('products')} />
              {isAdmin && (
                <>
                  <NavButton icon="group" label="Clientes" isActive={page === 'customers'} onClick={() => setPage('customers')} />
                  <NavButton icon="analytics" label="Historial" isActive={page === 'history'} onClick={() => setPage('history')} />
                  <NavButton icon="account_balance_wallet" label="Caja y Contabilidad" isActive={page === 'accounting'} onClick={() => setPage('accounting')} />
                  <NavButton icon="currency_exchange" label="Cotización" isActive={page === 'currency'} onClick={() => setPage('currency')} />
                  <NavButton icon="domain" label="Empresa" isActive={page === 'company'} onClick={() => setPage('company')} />
                </>
              )}
            </ul>
             {isAdmin && (
                <ul className="nav-list">
                    <NavButton 
                        icon="settings" 
                        label="Configuración" 
                        isActive={page === 'settings'} 
                        onClick={() => setPage('settings')} 
                    />
                    <NavButton 
                        icon="notifications" 
                        label="Notificaciones" 
                        isActive={page === 'notifications'} 
                        onClick={() => setPage('notifications')} 
                        badgeCount={notifications.length}
                    />
                </ul>
            )}
        </div>
        <div className="sidebar-footer">
            <div className="user-info">
                <span className="user-info-name">{currentUser.username}</span>
                <span className="user-info-role">{currentUser.role === 'admin' ? 'Administrador' : 'Cajero'}</span>
            </div>
             <button onClick={logout} className="btn btn-icon" title="Cerrar Sesión">
                <span className="material-symbols-outlined">logout</span>
            </button>
            <button onClick={toggleTheme} className="btn btn-icon theme-toggle-btn" title="Cambiar tema">
                <span className="material-symbols-outlined">
                    {settings.theme === 'light' ? 'dark_mode' : 'light_mode'}
                </span>
            </button>
            <Clock />
        </div>
      </nav>
      <main className="main-content">
        {renderPage()}
      </main>
      <ProductModal 
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        onSave={saveProduct}
        product={editingProduct}
      />
       <CustomerModal 
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        onSave={saveCustomer}
        customer={editingCustomer}
      />
       <CreditManagementModal
        isOpen={isCreditModalOpen}
        onClose={() => setIsCreditModalOpen(false)}
        customer={managingCreditCustomer}
        onSavePayment={handleSavePayment}
        onApplyInterest={applyCustomerInterest}
        onReverseInterest={reverseLastInterest}
      />
       <PaymentReceiptModal
            isOpen={isPaymentReceiptModalOpen}
            onClose={() => setIsPaymentReceiptModalOpen(false)}
            paymentData={lastPaymentData}
            companyInfo={companyInfo}
       />
    </div>
  );
};


const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <DataProvider>
            <App />
        </DataProvider>
    </React.StrictMode>
);