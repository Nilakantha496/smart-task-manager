import os
from flask import Flask, render_template, redirect, url_for, request, jsonify, flash
from flask_login import login_user, login_required, logout_user, current_user
from extensions import db, login_manager, bcrypt, socketio
from models import User, Task

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = 'dev-secret-key-123'
    
    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    elif os.environ.get('VERCEL'):
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////tmp/tasks.db'
    else:
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///tasks.db'
        
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    db.init_app(app)
    login_manager.init_app(app)
    bcrypt.init_app(app)
    socketio.init_app(app)

    login_manager.login_view = 'login'

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

    @app.route('/')
    @login_required
    def index():
        return render_template('index.html')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            username = request.form.get('username')
            email = request.form.get('email')
            password = request.form.get('password')
            
            # Basic validation
            if User.query.filter_by(username=username).first() or User.query.filter_by(email=email).first():
                flash('Username or Email already exists.', 'error')
                return redirect(url_for('register'))

            hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
            new_user = User(username=username, email=email, password_hash=hashed_pw)
            db.session.add(new_user)
            db.session.commit()
            flash('Registration successful. Please login.', 'success')
            return redirect(url_for('login'))
        return render_template('register.html')

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            user = User.query.filter_by(email=email).first()
            if user and bcrypt.check_password_hash(user.password_hash, password):
                login_user(user)
                return redirect(url_for('index'))
            else:
                flash('Login Unsuccessful. Please check email and password', 'error')
        return render_template('login.html')

    @app.route('/logout')
    @login_required
    def logout():
        logout_user()
        return redirect(url_for('login'))

    # API Routes for Tasks
    @app.route('/api/tasks', methods=['GET'])
    @login_required
    def get_tasks():
        tasks = Task.query.filter_by(user_id=current_user.id).all()
        return jsonify([task.to_dict() for task in tasks])

    @app.route('/api/tasks', methods=['POST'])
    @login_required
    def create_task():
        data = request.get_json()
        new_task = Task(
            title=data['title'],
            description=data.get('description', ''),
            priority=data.get('priority', 'Medium'),
            due_date=data.get('due_date'),
            user_id=current_user.id
        )
        db.session.add(new_task)
        db.session.commit()
        task_data = new_task.to_dict()
        socketio.emit('task_created', task_data, room=str(current_user.id))
        return jsonify(task_data), 201

    @app.route('/api/tasks/<int:task_id>', methods=['PUT'])
    @login_required
    def update_task(task_id):
        task = Task.query.get_or_404(task_id)
        if task.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        data = request.get_json()
        if 'title' in data:
            task.title = data['title']
        if 'description' in data:
            task.description = data['description']
        if 'is_completed' in data:
            task.is_completed = data['is_completed']
        if 'priority' in data:
            task.priority = data['priority']
        if 'due_date' in data:
            task.due_date = data['due_date']
        db.session.commit()
        task_data = task.to_dict()
        socketio.emit('task_updated', task_data, room=str(current_user.id))
        return jsonify(task_data)

    @app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
    @login_required
    def delete_task(task_id):
        task = Task.query.get_or_404(task_id)
        if task.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        db.session.delete(task)
        db.session.commit()
        socketio.emit('task_deleted', {'id': task_id}, room=str(current_user.id))
        return '', 204

    @socketio.on('join')
    def on_join():
        if current_user.is_authenticated:
            from flask_socketio import join_room
            join_room(str(current_user.id))

    return app

app = create_app()
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)
