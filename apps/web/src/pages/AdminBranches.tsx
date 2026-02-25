import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    Building,
    Plus,
    Edit,
    Trash2,
    Users,
    CheckCircle,
    XCircle,
    AlertCircle,
    Search,
    Calendar,
    UserPlus,
    Key,
    Mail,
    User,
    Shield,
    Eye,
    EyeOff,
    Save,
    X,
    Info,
} from "lucide-react";
import {
    adminGetBranches,
    adminCreateBranch,
    adminUpdateBranch,
    adminDeleteBranch,
    adminGetBranchUsers,
    adminCreateBranchUser,
    adminUpdateUser,
    adminChangeUserPassword,
    type Branch,
    type BranchUser,
    type CreateBranchData,
    type UpdateBranchData,
    type CreateUserData,
    type UpdateUserData,
} from "../api/adminBranches";

type ModalMode = "create" | "edit" | "delete" | "users" | "createUser" | "editUser" | "changePassword";

export default function AdminBranches() {
    const nav = useNavigate();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<ModalMode>("create");
    const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
    const [selectedUser, setSelectedUser] = useState<BranchUser | null>(null);
    const [branchUsers, setBranchUsers] = useState<BranchUser[]>([]);

    // Form state - Branch
    const [branchName, setBranchName] = useState("");
    const [branchIsActive, setBranchIsActive] = useState(true);

    // Form state - User
    const [userName, setUserName] = useState("");
    const [userEmail, setUserEmail] = useState("");
    const [userPassword, setUserPassword] = useState("");
    const [userUsername, setUserUsername] = useState("");
    const [userRole, setUserRole] = useState<"ADMIN" | "STAFF" | "COUNTER" | "PRODUCTION">("COUNTER");
    const [userIsActive, setUserIsActive] = useState(true);
    const [newPassword, setNewPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    // Form state - Loading
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        loadBranches();
    }, []);

    async function loadBranches() {
        setLoading(true);
        setError(null);
        try {
            const data = await adminGetBranches();
            setBranches(data);
        } catch (e: any) {
            setError(e?.message || "Error al cargar sucursales");
        } finally {
            setLoading(false);
        }
    }

    async function loadBranchUsers(branchId: number) {
        try {
            const users = await adminGetBranchUsers(branchId);
            setBranchUsers(users);
        } catch (e: any) {
            setFormError(e?.message || "Error al cargar usuarios");
        }
    }

    // Filtrar sucursales
    const filteredBranches = branches.filter(branch =>
        branch.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Abrir modal para crear sucursal
    function openCreateModal() {
        setModalMode("create");
        setBranchName("");
        setBranchIsActive(true);
        setUserEmail("");
        setUserPassword("");
        setFormError(null);
        setSuccessMessage(null);
        setModalOpen(true);
    }

    // Abrir modal para editar sucursal
    function openEditModal(branch: Branch) {
        setModalMode("edit");
        setSelectedBranch(branch);
        setBranchName(branch.name);
        setBranchIsActive(branch.isActive);
        setNewPassword(""); // Limpiar campo de contraseña
        setFormError(null);
        setSuccessMessage(null);
        setModalOpen(true);
    }

    // Abrir modal para eliminar sucursal
    function openDeleteModal(branch: Branch) {
        setModalMode("delete");
        setSelectedBranch(branch);
        setFormError(null);
        setSuccessMessage(null);
        setModalOpen(true);
    }

    // Abrir modal de usuarios
    async function openUsersModal(branch: Branch) {
        setModalMode("users");
        setSelectedBranch(branch);
        setBranchUsers([]);
        setFormError(null);
        setSuccessMessage(null);
        setModalOpen(true);
        await loadBranchUsers(branch.id);
    }

    // Abrir modal para crear usuario
    function openCreateUserModal() {
        setModalMode("createUser");
        setUserName("");
        setUserUsername("");  // 👈 NUEVO
        setUserEmail("");
        setUserPassword("");
        setUserRole("COUNTER"); // 👈 Default a COUNTER
        setUserIsActive(true);
        setFormError(null);
        setSuccessMessage(null);
    }
    // Abrir modal para editar usuario
    function openEditUserModal(user: BranchUser) {
        setModalMode("editUser");
        setSelectedUser(user);
        setUserName(user.name);
        setUserUsername(user.username);  // 👈 NUEVO
        setUserEmail(user.email || "");
        setUserRole(user.role);
        setUserIsActive(user.isActive);
        setFormError(null);
        setSuccessMessage(null);
    }

    // Abrir modal para cambiar contraseña
    function openChangePasswordModal(user: BranchUser) {
        setModalMode("changePassword");
        setSelectedUser(user);
        setNewPassword("");
        setFormError(null);
        setSuccessMessage(null);
    }

    // Cerrar modal
    function closeModal() {
        setModalOpen(false);
        setSelectedBranch(null);
        setSelectedUser(null);
        setBranchUsers([]);
        setFormError(null);
        setSuccessMessage(null);
        // Limpiar formularios
        setBranchName("");
        setBranchIsActive(true);
        setUserName("");
        setUserEmail("");
        setUserPassword("");
        setUserRole("STAFF");
        setUserIsActive(true);
        setNewPassword("");
    }
    // Guardar sucursal (crear o editar)
    async function handleSaveBranch() {
        if (!branchName.trim()) {
            setFormError("El nombre es obligatorio");
            return;
        }

        // Validaciones específicas para creación
        if (modalMode === "create") {
            if (!userName.trim()) {
                setFormError("El nombre del administrador es obligatorio");
                return;
            }
            if (!userUsername.trim()) {
                setFormError("El nombre de usuario es obligatorio");
                return;
            }
            if (!userPassword.trim()) {
                setFormError("La contraseña es obligatoria");
                return;
            }
            if (userPassword.length < 6) {
                setFormError("La contraseña debe tener al menos 6 caracteres");
                return;
            }
        }

        setSaving(true);
        setFormError(null);

        try {
            if (modalMode === "create") {
                const data: CreateBranchData = {
                    name: branchName.trim(),
                    adminName: userName.trim(),
                    adminUsername: userUsername.trim(),
                    adminPassword: userPassword,
                    isActive: branchIsActive,
                };
                await adminCreateBranch(data);
                setSuccessMessage("Sucursal creada correctamente");
            } else if (modalMode === "edit" && selectedBranch) {
                const data: UpdateBranchData = {
                    name: branchName.trim(),
                    isActive: branchIsActive,
                };
                await adminUpdateBranch(selectedBranch.id, data);
                setSuccessMessage("Sucursal actualizada correctamente");
            }
            await loadBranches();
            setTimeout(() => {
                closeModal();
            }, 1500);
        } catch (e: any) {
            setFormError(e?.message || "Error al guardar sucursal");
        } finally {
            setSaving(false);
        }
    }

    // Eliminar sucursal
    async function handleDeleteBranch() {
        if (!selectedBranch) return;

        setSaving(true);
        setFormError(null);

        try {
            await adminDeleteBranch(selectedBranch.id);
            setSuccessMessage("Sucursal eliminada correctamente");
            await loadBranches();
            setTimeout(() => {
                closeModal();
            }, 1500);
        } catch (e: any) {
            setFormError(e?.message || "Error al eliminar sucursal");
        } finally {
            setSaving(false);
        }
    }

    // Guardar usuario (crear o editar)
    async function handleSaveUser() {
        if (!selectedBranch) return;

        // Validaciones
        if (!userName.trim()) {
            setFormError("El nombre es obligatorio");
            return;
        }
        if (!userUsername.trim()) {  // 👈 Validar username
            setFormError("El nombre de usuario es obligatorio");
            return;
        }
        if (modalMode === "createUser" && !userPassword.trim()) {
            setFormError("La contraseña es obligatoria");
            return;
        }
        if (modalMode === "createUser" && userPassword.length < 6) {
            setFormError("La contraseña debe tener al menos 6 caracteres");
            return;
        }

        setSaving(true);
        setFormError(null);

        try {
            if (modalMode === "createUser") {
                const data: CreateUserData = {
                    name: userName.trim(),
                    username: userUsername.trim(),  // 👈 Incluir username
                    email: userEmail.trim() || null,
                    password: userPassword,
                    role: userRole,
                    isActive: userIsActive,
                };
                await adminCreateBranchUser(selectedBranch.id, data);
                setSuccessMessage("Usuario creado correctamente");
            } else if (modalMode === "editUser" && selectedUser) {
                const data: UpdateUserData = {
                    name: userName.trim(),
                    username: userUsername.trim(),  // 👈 Incluir username
                    email: userEmail.trim() || null,
                    role: userRole,
                    isActive: userIsActive,
                };
                await adminUpdateUser(selectedUser.id, data);
                setSuccessMessage("Usuario actualizado correctamente");
            }
            await loadBranchUsers(selectedBranch.id);
            setTimeout(() => {
                setModalMode("users");
                setSelectedUser(null);
            }, 1500);
        } catch (e: any) {
            setFormError(e?.message || "Error al guardar usuario");
        } finally {
            setSaving(false);
        }
    }

    // Cambiar contraseña
    async function handleChangePassword() {
        if (!selectedUser) return;

        if (!newPassword.trim()) {
            setFormError("La nueva contraseña es obligatoria");
            return;
        }
        if (newPassword.length < 6) {
            setFormError("La contraseña debe tener al menos 6 caracteres");
            return;
        }

        setSaving(true);
        setFormError(null);

        try {
            await adminChangeUserPassword(selectedUser.id, newPassword);
            setSuccessMessage("Contraseña actualizada correctamente");
            setNewPassword("");
            setTimeout(() => {
                setSuccessMessage(null);
            }, 3000);
        } catch (e: any) {
            setFormError(e?.message || "Error al cambiar contraseña");
        } finally {
            setSaving(false);
        }
    }
    const goOrders = () => {
        // Ajusta la ruta si en tu app se llama diferente
        nav("/orders");
    };
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-pink-600 to-purple-600 rounded-2xl mb-4 shadow-lg">
                        <Building className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
                        Administrar Sucursales
                    </h1>
                    <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                        Gestiona las sucursales y sus usuarios. Puedes{" "}
                        <span className="font-semibold text-pink-600">crear, editar y desactivar</span> sucursales.
                    </p>
                </div>

                {/* Barra de acciones */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                        <div className="relative w-full sm:w-96">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                            <input
                                type="text"
                                placeholder="Buscar sucursal..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                            />
                        </div>

                        <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
                            <button
                                type="button"
                                onClick={goOrders}
                                className="w-full sm:w-auto px-6 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 shadow-sm hover:shadow transition-all flex items-center justify-center gap-2"
                            >
                                <Building className="w-5 h-5 text-gray-600" />
                                Pedidos Activos
                            </button>

                            <button
                                type="button"
                                onClick={openCreateModal}
                                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                            >
                                <Plus className="w-5 h-5" />
                                Nueva Sucursal
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                            <p className="text-red-700">{error}</p>
                        </div>
                    </div>
                )}

                {/* Grid de sucursales */}
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600"></div>
                    </div>
                ) : filteredBranches.length === 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                        <Building className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No hay sucursales</h3>
                        <p className="text-gray-500 mb-6">
                            {searchTerm ? "No se encontraron resultados" : "Comienza creando una nueva sucursal"}
                        </p>
                        {searchTerm ? (
                            <button
                                onClick={() => setSearchTerm("")}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
                            >
                                Limpiar búsqueda
                            </button>
                        ) : (
                            <button
                                onClick={openCreateModal}
                                className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg inline-flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Crear primera sucursal
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredBranches.map((branch) => (
                            <div
                                key={branch.id}
                                className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                            >
                                <div className="p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-3 rounded-xl ${branch.isActive ? 'bg-green-100' : 'bg-gray-100'
                                                }`}>
                                                <Building className={`w-6 h-6 ${branch.isActive ? 'text-green-600' : 'text-gray-500'
                                                    }`} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900">{branch.name}</h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {branch.isActive ? (
                                                        <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                                            <CheckCircle className="w-3 h-3" />
                                                            Activa
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                                                            <XCircle className="w-3 h-3" />
                                                            Inactiva
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => openUsersModal(branch)}
                                                className="p-2 text-gray-500 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
                                                title="Ver usuarios"
                                            >
                                                <Users className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => openEditModal(branch)}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Editar"
                                            >
                                                <Edit className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => openDeleteModal(branch)}
                                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Eliminar"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-sm text-gray-600">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-gray-400" />
                                            <span>Creada: {new Date(branch.createdAt).toLocaleDateString('es-MX')}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Users className="w-4 h-4 text-gray-400" />
                                            <span>{branch.users?.length || 0} usuarios</span>
                                        </div>
                                    </div>
                                </div>

                                {branch.users && branch.users.length > 0 && (
                                    <div className="border-t border-gray-100 bg-gray-50 px-6 py-3">
                                        <div className="space-y-2">
                                            {branch.users.slice(0, 2).map(user => (
                                                <div key={user.id} className="flex items-center justify-between text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <User className="w-3 h-3 text-gray-500" />
                                                        <span className="font-medium">{user.name}</span>
                                                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                                                            user.role === 'STAFF' ? 'bg-blue-100 text-blue-700' :
                                                                user.role === 'COUNTER' ? 'bg-green-100 text-green-700' :
                                                                    'bg-orange-100 text-orange-700'
                                                            }`}>
                                                            {user.role === 'ADMIN' ? 'Admin' :
                                                                user.role === 'STAFF' ? 'Staff' :
                                                                    user.role === 'COUNTER' ? 'Mostrador' : 'Prod'}
                                                        </span>
                                                    </div>
                                                    <span className="text-gray-500 font-mono">@{user.username}</span>
                                                </div>
                                            ))}
                                            {branch.users.length > 2 && (
                                                <div className="text-xs text-gray-500 text-center">
                                                    +{branch.users.length - 2} usuarios más
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* MODAL */}
                {modalOpen && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            {/* Header del modal */}
                            <div className={`p-6 border-b ${modalMode === "delete" ? 'bg-red-50' :
                                modalMode.includes('user') ? 'bg-purple-50' : 'bg-pink-50'
                                }`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-3 rounded-xl ${modalMode === "delete" ? 'bg-red-100' :
                                            modalMode === "users" ? 'bg-purple-100' :
                                                modalMode.includes('user') ? 'bg-purple-100' : 'bg-pink-100'
                                            }`}>
                                            {modalMode === "delete" && <Trash2 className="w-6 h-6 text-red-600" />}
                                            {modalMode === "users" && <Users className="w-6 h-6 text-purple-600" />}
                                            {modalMode === "create" && <Plus className="w-6 h-6 text-pink-600" />}
                                            {modalMode === "edit" && <Edit className="w-6 h-6 text-pink-600" />}
                                            {modalMode === "createUser" && <UserPlus className="w-6 h-6 text-purple-600" />}
                                            {modalMode === "editUser" && <Edit className="w-6 h-6 text-purple-600" />}
                                            {modalMode === "changePassword" && <Key className="w-6 h-6 text-purple-600" />}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-900">
                                                {modalMode === "create" && "Nueva Sucursal"}
                                                {modalMode === "edit" && `Editar: ${selectedBranch?.name}`}
                                                {modalMode === "delete" && "Eliminar Sucursal"}
                                                {modalMode === "users" && `Usuarios: ${selectedBranch?.name}`}
                                                {modalMode === "createUser" && "Nuevo Usuario"}
                                                {modalMode === "editUser" && `Editar: ${selectedUser?.name}`}
                                                {modalMode === "changePassword" && `Cambiar contraseña: ${selectedUser?.name}`}
                                            </h2>
                                            <p className="text-sm text-gray-600 mt-1">
                                                {modalMode === "delete" && "Esta acción no se puede deshacer"}
                                                {modalMode === "users" && "Administra los usuarios de esta sucursal"}
                                                {modalMode === "createUser" && "Agrega un nuevo usuario a la sucursal"}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={closeModal}
                                        className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5 text-gray-500" />
                                    </button>
                                </div>
                            </div>

                            {/* Contenido del modal */}
                            <div className="p-6">
                                {successMessage && (
                                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                                        <div className="flex items-center gap-3">
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                            <p className="text-green-700">{successMessage}</p>
                                        </div>
                                    </div>
                                )}

                                {formError && (
                                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                                        <div className="flex items-center gap-3">
                                            <AlertCircle className="w-5 h-5 text-red-600" />
                                            <p className="text-red-700">{formError}</p>
                                        </div>
                                    </div>
                                )}
                                {/* Modal: Crear Sucursal */}
                                {modalMode === "create" && (
                                    <div className="space-y-4">
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                                            <div className="flex items-start gap-3">
                                                <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                                                <div className="text-sm text-blue-800">
                                                    <p className="font-medium mb-1">Nueva Sucursal</p>
                                                    <p>Se creará automáticamente un usuario STAFF con los datos que proporciones.</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Nombre de la sucursal <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={branchName}
                                                onChange={(e) => setBranchName(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                                                placeholder="Ej. Sucursal Centro"
                                                autoFocus
                                            />
                                        </div>

                                        <div className="border-t border-gray-200 pt-4">
                                            <h4 className="font-medium text-gray-900 mb-3">Datos del administrador</h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Nombre del administrador <span className="text-red-500">*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={userName}
                                                        onChange={(e) => setUserName(e.target.value)}
                                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                                                        placeholder="Ej. Juan Pérez"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Nombre de usuario <span className="text-red-500">*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={userUsername}
                                                        onChange={(e) => setUserUsername(e.target.value)}
                                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                                                        placeholder="ej. admin.centro"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Email (opcional)
                                                    </label>
                                                    <input
                                                        type="email"
                                                        value={userEmail}
                                                        onChange={(e) => setUserEmail(e.target.value)}
                                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                                                        placeholder="correo@ejemplo.com"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Contraseña <span className="text-red-500">*</span>
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type={showPassword ? "text" : "password"}
                                                            value={userPassword}
                                                            onChange={(e) => setUserPassword(e.target.value)}
                                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500 pr-12"
                                                            placeholder="Mínimo 6 caracteres"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPassword(!showPassword)}
                                                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                        >
                                                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Estado de la sucursal
                                            </label>
                                            <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={branchIsActive}
                                                        onChange={() => setBranchIsActive(true)}
                                                        className="w-4 h-4 text-pink-600 border-gray-300 focus:ring-pink-500"
                                                    />
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                                        Activa
                                                    </span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={!branchIsActive}
                                                        onChange={() => setBranchIsActive(false)}
                                                        className="w-4 h-4 text-pink-600 border-gray-300 focus:ring-pink-500"
                                                    />
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="w-4 h-4 text-gray-500" />
                                                        Inactiva
                                                    </span>
                                                </label>
                                            </div>
                                        </div>

                                        <div className="bg-gray-50 p-3 rounded-lg">
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Shield className="w-4 h-4 text-gray-400" />
                                                <span>Rol asignado automáticamente: <span className="font-medium text-pink-600">STAFF</span></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {/* Modal: Editar Sucursal */}
                                {modalMode === "edit" && selectedBranch && (
                                    <div className="space-y-6">
                                        {/* SECCIÓN 1: Datos de la sucursal */}
                                        <div>
                                            <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                                                <Building className="w-4 h-4 text-pink-600" />
                                                Datos de la sucursal
                                            </h4>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Nombre de la sucursal
                                                </label>
                                                <input
                                                    type="text"
                                                    value={branchName}
                                                    onChange={(e) => setBranchName(e.target.value)}
                                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                                                    placeholder="Ej. Sucursal Centro"
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="mt-4">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Estado
                                                </label>
                                                <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            checked={branchIsActive}
                                                            onChange={() => setBranchIsActive(true)}
                                                            className="w-4 h-4 text-pink-600 border-gray-300 focus:ring-pink-500"
                                                        />
                                                        <span className="flex items-center gap-1">
                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                            Activa
                                                        </span>
                                                    </label>
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            checked={!branchIsActive}
                                                            onChange={() => setBranchIsActive(false)}
                                                            className="w-4 h-4 text-pink-600 border-gray-300 focus:ring-pink-500"
                                                        />
                                                        <span className="flex items-center gap-1">
                                                            <XCircle className="w-4 h-4 text-gray-500" />
                                                            Inactiva
                                                        </span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>

                                        {/* SECCIÓN 2: Usuario asociado */}
                                        {selectedBranch.users && selectedBranch.users.length > 0 && (
                                            <div className="border-t border-gray-200 pt-6">
                                                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                                                    <User className="w-4 h-4 text-pink-600" />
                                                    Usuario STAFF asociado
                                                </h4>

                                                {selectedBranch.users.map((user) => (
                                                    <div key={user.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <div>
                                                                <p className="font-medium text-gray-900">{user.name}</p>
                                                                <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">

                                                                    {user.email}
                                                                </p>
                                                            </div>
                                                            <span className={`text-xs px-2 py-1 rounded-full ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-700'
                                                                }`}>
                                                                {user.role}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Si no tiene usuarios */}
                                        {(!selectedBranch.users || selectedBranch.users.length === 0) && (
                                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                                <p className="text-yellow-800 text-sm">
                                                    Esta sucursal no tiene usuarios asociados. Puedes crear uno desde la sección de usuarios.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Modal: Eliminar Sucursal */}
                                {modalMode === "delete" && selectedBranch && (
                                    <div className="text-center py-4">
                                        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <AlertCircle className="w-10 h-10 text-red-600" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                            ¿Eliminar "{selectedBranch.name}"?
                                        </h3>
                                        <p className="text-gray-600 mb-6">
                                            Esta acción eliminará permanentemente la sucursal.
                                            {selectedBranch.users && selectedBranch.users.length > 0 && (
                                                <span className="block mt-2 text-red-600 font-medium">
                                                    ⚠️ Tiene {selectedBranch.users.length} usuario(s) asociado(s)
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                )}
                                {/* Modal: Lista de Usuarios */}
                                {modalMode === "users" && selectedBranch && (
                                    <div>
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="font-semibold text-gray-900">
                                                {branchUsers.length} usuario(s)
                                            </h3>
                                            <button
                                                onClick={openCreateUserModal}
                                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2"
                                            >
                                                <UserPlus className="w-4 h-4" />
                                                Nuevo Usuario
                                            </button>
                                        </div>

                                        {branchUsers.length === 0 ? (
                                            <div className="text-center py-8 bg-gray-50 rounded-lg">
                                                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                                                <p className="text-gray-500">No hay usuarios en esta sucursal</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {branchUsers.map((user) => (
                                                    <div
                                                        key={user.id}
                                                        className="bg-gray-50 border border-gray-200 rounded-lg p-4"
                                                    >
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <span className="font-medium text-gray-900">{user.name}</span>
                                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                                                                        user.role === 'STAFF' ? 'bg-blue-100 text-blue-700' :
                                                                            user.role === 'COUNTER' ? 'bg-green-100 text-green-700' :
                                                                                'bg-orange-100 text-orange-700'
                                                                        }`}>
                                                                        {user.role === 'ADMIN' && 'Administrador'}
                                                                        {user.role === 'STAFF' && 'Staff'}
                                                                        {user.role === 'COUNTER' && 'Mostrador'}
                                                                        {user.role === 'PRODUCTION' && 'Producción'}
                                                                    </span>
                                                                    {user.isActive ? (
                                                                        <span className="flex items-center gap-1 text-xs text-green-600">
                                                                            <CheckCircle className="w-3 h-3" />
                                                                            Activo
                                                                        </span>
                                                                    ) : (
                                                                        <span className="flex items-center gap-1 text-xs text-gray-500">
                                                                            <XCircle className="w-3 h-3" />
                                                                            Inactivo
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="space-y-1 text-sm">
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <User className="w-4 h-4" />
                                                                        <span className="font-mono">{user.username}</span>
                                                                    </div>
                                                                    {user.email && (
                                                                        <div className="flex items-center gap-2 text-gray-600">
                                                                            <Mail className="w-4 h-4" />
                                                                            {user.email}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={() => openChangePasswordModal(user)}
                                                                    className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                                                                    title="Cambiar contraseña"
                                                                >
                                                                    <Key className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => openEditUserModal(user)}
                                                                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                                                >
                                                                    <Edit className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {/* Modal: Crear/Editar Usuario */}
                                {(modalMode === "createUser" || modalMode === "editUser") && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Nombre completo <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={userName}
                                                onChange={(e) => setUserName(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                                placeholder="Ej. Juan Pérez"
                                                autoFocus
                                            />
                                        </div>

                                        {/* 👈 NUEVO CAMPO: Username */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Nombre de usuario <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={userUsername}
                                                onChange={(e) => setUserUsername(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                                placeholder="ej. juan.perez"
                                            />
                                            <p className="text-xs text-gray-500 mt-2">
                                                Usuario para iniciar sesión en el sistema
                                            </p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Email (opcional)
                                            </label>
                                            <input
                                                type="email"
                                                value={userEmail}
                                                onChange={(e) => setUserEmail(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                                placeholder="correo@ejemplo.com"
                                            />
                                        </div>

                                        {modalMode === "createUser" && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Contraseña <span className="text-red-500">*</span>
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showPassword ? "text" : "password"}
                                                        value={userPassword}
                                                        onChange={(e) => setUserPassword(e.target.value)}
                                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 pr-12"
                                                        placeholder="Mínimo 6 caracteres"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowPassword(!showPassword)}
                                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                    >
                                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Rol <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={userRole}
                                                onChange={(e) => setUserRole(e.target.value as any)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                            >
                                                <option value="COUNTER">👤 Mostrador (atiende clientes)</option>
                                                <option value="PRODUCTION">⚙️ Producción (fabrica)</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Estado
                                            </label>
                                            <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={userIsActive}
                                                        onChange={() => setUserIsActive(true)}
                                                        className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                                                    />
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                                        Activo
                                                    </span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={!userIsActive}
                                                        onChange={() => setUserIsActive(false)}
                                                        className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                                                    />
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="w-4 h-4 text-gray-500" />
                                                        Inactivo
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Modal: Cambiar Contraseña */}
                                {modalMode === "changePassword" && selectedUser && (
                                    <div className="space-y-4">
                                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                            <div className="flex items-start gap-3">
                                                <Key className="w-5 h-5 text-yellow-600 mt-0.5" />
                                                <div className="text-sm text-yellow-800">
                                                    <p className="font-medium mb-1">Cambiar contraseña</p>
                                                    <p>Usuario: <span className="font-mono">{selectedUser.username}</span> - {selectedUser.name}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Nueva contraseña <span className="text-red-500">*</span>
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showPassword ? "text" : "password"}
                                                    value={newPassword}
                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 pr-12"
                                                    placeholder="Mínimo 6 caracteres"
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                >
                                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-2">
                                                La contraseña debe tener al menos 6 caracteres
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer del modal */}
                            <div className="p-6 border-t border-gray-200 bg-gray-50">
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={closeModal}
                                        className="px-6 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 transition-colors"
                                    >
                                        Cancelar
                                    </button>

                                    {modalMode === "create" && (
                                        <button
                                            onClick={handleSaveBranch}
                                            disabled={saving || !branchName || !userEmail || !userPassword || userPassword.length < 6}
                                            className="px-6 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {saving ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    Creando...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-4 h-4" />
                                                    Crear Sucursal
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {modalMode === "edit" && (
                                        <button
                                            onClick={handleSaveBranch}
                                            disabled={saving}
                                            className="px-6 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                                        >
                                            {saving ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    Guardando...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-4 h-4" />
                                                    Guardar Cambios
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {modalMode === "delete" && (
                                        <button
                                            onClick={handleDeleteBranch}
                                            disabled={saving}
                                            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                                        >
                                            {saving ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    Eliminando...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 className="w-4 h-4" />
                                                    Eliminar
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {modalMode === "users" && (
                                        <button
                                            onClick={closeModal}
                                            className="px-6 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg"
                                        >
                                            Cerrar
                                        </button>
                                    )}

                                    {(modalMode === "createUser" || modalMode === "editUser") && (
                                        <button
                                            onClick={handleSaveUser}
                                            disabled={saving}
                                            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                                        >
                                            {saving ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    Guardando...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-4 h-4" />
                                                    {modalMode === "createUser" ? "Crear Usuario" : "Guardar Cambios"}
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {modalMode === "changePassword" && (
                                        <button
                                            onClick={handleChangePassword}
                                            disabled={saving || !newPassword || newPassword.length < 6}
                                            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {saving ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    Actualizando...
                                                </>
                                            ) : (
                                                <>
                                                    <Key className="w-4 h-4" />
                                                    Cambiar contraseña
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}