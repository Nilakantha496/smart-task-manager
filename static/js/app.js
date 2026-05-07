document.addEventListener('DOMContentLoaded', () => {
    // Only run on dashboard
    if (!document.getElementById('task-board') && !document.querySelector('.task-board')) return;

    const socket = io();
    let tasks = [];

    // DOM Elements
    const pendingTasksEl = document.getElementById('pending-tasks');
    const completedTasksEl = document.getElementById('completed-tasks');
    const pendingCountEl = document.getElementById('pending-count');
    const completedCountEl = document.getElementById('completed-count');
    const modal = document.getElementById('task-modal');
    const addTaskBtn = document.getElementById('add-task-btn');
    const closeBtn = document.querySelector('.close-modal');
    const taskForm = document.getElementById('task-form');
    const modalTitle = document.getElementById('modal-title');
    const searchInput = document.getElementById('search-input');
    const priorityFilter = document.getElementById('priority-filter');
    
    let currentSearch = '';
    let currentFilter = 'All';

    // Initialize
    socket.on('connect', () => {
        socket.emit('join');
    });

    fetchTasks();

    // Initialize SortableJS
    if (typeof Sortable !== 'undefined') {
        const sortableOptions = {
            group: 'shared',
            animation: 150,
            ghostClass: 'glass-panel',
            onEnd: async function (evt) {
                const itemEl = evt.item;
                const newParent = evt.to;
                const taskId = itemEl.getAttribute('data-id');
                const isCompleted = newParent.id === 'completed-tasks';
                
                // Only toggle if moved to a different list
                if (evt.from.id !== evt.to.id) {
                    if (isCompleted && typeof confetti !== 'undefined') {
                        confetti({
                            particleCount: 100,
                            spread: 70,
                            origin: { y: 0.6 }
                        });
                    }
                    await window.toggleTask(taskId, isCompleted);
                }
            },
        };
        new Sortable(pendingTasksEl, sortableOptions);
        new Sortable(completedTasksEl, sortableOptions);
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.toLowerCase();
            renderTasks();
        });
    }

    if (priorityFilter) {
        priorityFilter.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            renderTasks();
        });
    }

    // Event Listeners
    addTaskBtn.addEventListener('click', () => {
        taskForm.reset();
        document.getElementById('task-id').value = '';
        modalTitle.textContent = 'Add New Task';
        modal.classList.add('show');
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });

    taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('task-id').value;
        const title = document.getElementById('task-title').value;
        const description = document.getElementById('task-desc').value;
        const priority = document.getElementById('task-priority').value;
        const due_date = document.getElementById('task-due').value;

        const taskData = { title, description, priority, due_date };

        try {
            if (id) {
                await fetch(`/api/tasks/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });
            } else {
                await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });
            }
            modal.classList.remove('show');
        } catch (error) {
            console.error('Error saving task:', error);
        }
    });

    // Socket Events
    socket.on('task_created', (task) => {
        tasks.push(task);
        renderTasks();
    });

    socket.on('task_updated', (updatedTask) => {
        const index = tasks.findIndex(t => t.id === updatedTask.id);
        if (index !== -1) {
            tasks[index] = updatedTask;
            renderTasks();
        }
    });

    socket.on('task_deleted', (data) => {
        tasks = tasks.filter(t => t.id !== data.id);
        renderTasks();
    });

    // Functions
    async function fetchTasks() {
        try {
            const res = await fetch('/api/tasks');
            tasks = await res.json();
            renderTasks();
        } catch (error) {
            console.error('Error fetching tasks:', error);
        }
    }

    function renderTasks() {
        pendingTasksEl.innerHTML = '';
        completedTasksEl.innerHTML = '';
        
        let pendingCount = 0;
        let completedCount = 0;

        tasks.forEach(task => {
            // Apply Filters
            if (currentFilter !== 'All' && task.priority !== currentFilter) return;
            if (currentSearch && !task.title.toLowerCase().includes(currentSearch) && 
                !(task.description && task.description.toLowerCase().includes(currentSearch))) return;

            const taskEl = createTaskElement(task);
            if (task.is_completed) {
                completedTasksEl.appendChild(taskEl);
                completedCount++;
            } else {
                pendingTasksEl.appendChild(taskEl);
                pendingCount++;
            }
        });

        pendingCountEl.textContent = pendingCount;
        completedCountEl.textContent = completedCount;
    }

    function createTaskElement(task) {
        const div = document.createElement('div');
        div.className = `task-card ${task.is_completed ? 'completed' : ''}`;
        div.setAttribute('data-id', task.id);
        
        const date = new Date(task.created_at).toLocaleDateString();
        const dueDateHtml = task.due_date ? `<span class="task-due-date"><i class="far fa-clock"></i> Due: ${task.due_date}</span>` : '';
        const priorityHtml = task.priority ? `<span class="priority-badge priority-${task.priority}">${task.priority}</span>` : '';

        div.innerHTML = `
            ${dueDateHtml}
            <h4 class="task-title">${priorityHtml}${escapeHtml(task.title)}</h4>
            ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
            <div class="task-meta">
                <span><i class="far fa-calendar-alt"></i> ${date}</span>
            </div>
            <div class="task-actions">
                <button class="icon-btn complete" onclick="toggleTask(${task.id}, ${!task.is_completed})" title="${task.is_completed ? 'Mark pending' : 'Mark completed'}">
                    <i class="fas ${task.is_completed ? 'fa-undo' : 'fa-check-circle'}"></i>
                </button>
                <button class="icon-btn edit" onclick="editTask(${task.id})" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="icon-btn delete" onclick="deleteTask(${task.id})" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        return div;
    }

    // Expose functions to global scope for inline onclick handlers
    window.toggleTask = async (id, isCompleted) => {
        try {
            await fetch(`/api/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_completed: isCompleted })
            });
        } catch (error) {
            console.error('Error toggling task:', error);
        }
    };

    window.editTask = (id) => {
        const task = tasks.find(t => t.id === id);
        if (task) {
            document.getElementById('task-id').value = task.id;
            document.getElementById('task-title').value = task.title;
            document.getElementById('task-desc').value = task.description || '';
            document.getElementById('task-priority').value = task.priority || 'Medium';
            document.getElementById('task-due').value = task.due_date || '';
            modalTitle.textContent = 'Edit Task';
            modal.classList.add('show');
        }
    };

    window.deleteTask = async (id) => {
        if (confirm('Are you sure you want to delete this task?')) {
            try {
                await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
            } catch (error) {
                console.error('Error deleting task:', error);
            }
        }
    };

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});
